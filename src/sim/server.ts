/**
 * Physics server: owns a Simulation inside the worker, runs a fixed-step
 * clock, publishes snapshots, applies commands. Also usable in-process (tests).
 *
 * Realtime clock: accumulator over absolute wall time. Sleeps precisely with
 * Atomics.wait (shared transport) — the main thread can Atomics.notify to wake
 * it for low-latency commands — then yields to the event loop through a
 * MessageChannel (no 4 ms setTimeout clamping) so queued messages are handled.
 */
import { Simulation } from './simulation.ts'
import { SnapshotSlot, layoutForVehicle, type SnapshotLayout } from './snapshot.ts'
import { TripleWriter } from './tripleBuffer.ts'
import { newTelemetry } from '../vehicles/runtime.ts'
import {
  CONTROLS_FLOATS,
  CTRL,
  CTRL_BYTES,
  readControls,
  wallMs,
  type Endpoint,
  type FromWorker,
  type InitMsg,
  type ToWorker,
} from './protocol.ts'

const MAX_STEPS_PER_TICK = 8
const IMPACT_MIN_INTERVAL_MS = 40

export class SimServer {
  readonly #ep: Endpoint
  #sim: Simulation | null = null
  #layout: SnapshotLayout | null = null
  #init: InitMsg | null = null
  // shared transport
  #slots: SnapshotSlot[] = []
  #writer: TripleWriter | null = null
  #ctrl: Int32Array | null = null
  #controls: Float32Array | null = null
  // transfer transport
  #pool: ArrayBuffer[] = []
  // clock
  #paused = false
  #timeScale = 1
  #accMs = 0
  #lastMs = 0
  #seq = 0
  #stepsWindow = 0
  #windowStart = 0
  #stepsPerSec = 0
  #lastImpact = 0
  #pendingImpact = 0
  #disposed = false
  #dirty = false
  #yield: MessageChannel | null = null
  readonly #tel = newTelemetry()

  constructor(ep: Endpoint) {
    this.#ep = ep
    ep.addEventListener('message', this.#onMessage)
    ep.start?.()
  }

  get simulation(): Simulation | null {
    return this.#sim
  }

  #post(msg: FromWorker, transfer: Transferable[] = []): void {
    this.#ep.postMessage(msg, transfer)
  }

  readonly #onMessage = (e: MessageEvent): void => {
    const msg = e.data as ToWorker
    try {
      this.#handle(msg)
    } catch (err: unknown) {
      this.#post({ type: 'error', message: err instanceof Error ? (err.stack ?? err.message) : String(err) })
    }
  }

  #handle(msg: ToWorker): void {
    switch (msg.type) {
      case 'init':
        this.#start(msg)
        break
      case 'controls':
        if (this.#sim) Object.assign(this.#sim.controls, msg.c)
        break
      case 'cmd':
        this.#sim?.apply(msg.cmd)
        // Publish immediately so e.g. a reset is visible without waiting a step.
        if (this.#paused || this.#init?.clock === 'manual') this.#publish()
        break
      case 'pause':
        this.#paused = msg.paused
        this.#lastMs = wallMs()
        this.#accMs = 0
        break
      case 'timeScale':
        this.#timeScale = msg.scale
        break
      case 'step':
        for (let i = 0; i < msg.n; i++) this.#stepOnce()
        this.#publish()
        this.#post({ type: 'stepped', id: msg.id })
        break
      case 'return':
        this.#pool.push(msg.buf)
        if (this.#dirty) this.#publish()
        break
      case 'dispose':
        this.#disposed = true
        this.#ep.removeEventListener('message', this.#onMessage)
        this.#yield?.port1.close()
        break
    }
  }

  #start(msg: InitMsg): void {
    const sim = new Simulation(msg.cfg)
    const L = layoutForVehicle(sim.vehicle)
    this.#sim = sim
    this.#layout = L
    this.#init = msg
    if (msg.transport === 'shared') {
      if (!msg.state || !msg.controls) throw new Error('shared transport needs state + controls buffers')
      if (msg.state.byteLength < CTRL_BYTES + 3 * L.bytes) throw new Error('state buffer too small for layout')
      this.#ctrl = new Int32Array(msg.state, 0, CTRL.count)
      this.#slots = [0, 1, 2].map((i) => new SnapshotSlot(msg.state!, CTRL_BYTES + i * L.bytes, L))
      this.#writer = new TripleWriter(this.#ctrl, CTRL.triple)
      this.#controls = new Float32Array(msg.controls, 0, CONTROLS_FLOATS)
    } else {
      this.#pool = [...(msg.buffers ?? [])]
    }
    this.#publish()
    this.#post({ type: 'ready', nodes: L.nodes, beams: L.beams })
    if (msg.clock === 'realtime') {
      this.#lastMs = wallMs()
      this.#windowStart = this.#lastMs
      this.#yield = new MessageChannel()
      this.#yield.port1.addEventListener('message', () => this.#tick())
      this.#yield.port1.start()
      this.#tick()
    }
  }

  #stepOnce(): void {
    const sim = this.#sim
    if (!sim) return
    if (this.#controls) readControls(this.#controls, sim.controls)
    const hit = sim.step()
    if (hit > 0) this.#pendingImpact = Math.max(this.#pendingImpact, hit)
  }

  #publish(): void {
    const sim = this.#sim
    const L = this.#layout
    if (!sim || !L) return
    const now = wallMs()
    if (this.#writer) {
      this.#slots[this.#writer.back]!.write(sim, this.#seq++, now, this.#stepsPerSec, this.#tel)
      this.#writer.publish()
    } else {
      const buf = this.#pool.pop()
      if (buf) {
        this.#dirty = false
        new SnapshotSlot(buf, 0, L).write(sim, this.#seq++, now, this.#stepsPerSec, this.#tel)
        this.#post({ type: 'state', buf }, [buf])
      } else {
        this.#dirty = true // reader is behind; publish as soon as a buffer returns
      }
    }
    if (this.#pendingImpact > 0 && now - this.#lastImpact > IMPACT_MIN_INTERVAL_MS) {
      this.#post({ type: 'impact', strength: this.#pendingImpact })
      this.#pendingImpact = 0
      this.#lastImpact = now
    }
  }

  #tick(): void {
    if (this.#disposed || !this.#sim) return
    const dtMs = this.#sim.dt * 1000
    const now = wallMs()
    const frame = now - this.#lastMs
    this.#lastMs = now
    if (!this.#paused) this.#accMs += frame * this.#timeScale
    let n = 0
    while (this.#accMs >= dtMs && n < MAX_STEPS_PER_TICK) {
      this.#stepOnce()
      this.#accMs -= dtMs
      n++
    }
    if (this.#accMs >= dtMs) this.#accMs %= dtMs // drop time we cannot catch up on
    if (n > 0) this.#publish()
    this.#stepsWindow += n
    if (now - this.#windowStart >= 1000) {
      this.#stepsPerSec = (this.#stepsWindow * 1000) / (now - this.#windowStart)
      this.#stepsWindow = 0
      this.#windowStart = now
    }
    const delay = this.#paused ? 16 : dtMs - this.#accMs
    const ctrl = this.#ctrl
    if (ctrl) {
      // Precise sleep; the main thread may Atomics.notify(wake) to cut it short.
      if (delay > 0.5) {
        Atomics.store(ctrl, CTRL.wake, 0)
        Atomics.wait(ctrl, CTRL.wake, 0, delay)
      }
      this.#yield?.port2.postMessage(null)
    } else {
      // No SharedArrayBuffer → no Atomics.wait. Coarse timer; render
      // interpolation by timestamps hides the jitter.
      setTimeout(() => this.#tick(), Math.max(0, delay - 1))
    }
  }
}
