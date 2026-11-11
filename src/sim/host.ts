/**
 * PhysicsHost: the main thread's single entry point to the simulation.
 *   InlineHost — Simulation stepped by the kernel's fixed step (tests,
 *                snapshots, fallback). Zero copies.
 *   WorkerHost — Simulation runs in a Web Worker on its own clock; state
 *                arrives as snapshots (SharedArrayBuffer triple buffer, or
 *                pooled transferable buffers without cross-origin isolation).
 * Both expose a `vehicle` whose pos/prevPos/frame/flags are current after
 * `sync()`, so render/camera/UI code is identical in both modes.
 */
import type { DriverControls } from '../input/input.ts'
import { Vehicle, newTelemetry, type VehicleTelemetry } from '../vehicles/runtime.ts'
import { getVehicle } from '../vehicles/registry.ts'
import { Simulation, copyControls, impactStrength, type SimCommand, type SimConfig } from './simulation.ts'
import { SnapshotSlot, layoutFor, newMeta, type SnapshotLayout } from './snapshot.ts'
import { TripleReader, initTripleCell } from './tripleBuffer.ts'
import {
  CONTROLS_FLOATS,
  CTRL,
  CTRL_BYTES,
  wallMs,
  writeControls,
  type ClockMode,
  type Endpoint,
  type FromWorker,
  type ToWorker,
  type Transport,
} from './protocol.ts'

export type HostKind = 'inline' | 'worker'

export interface HostStats {
  physicsMs: number
  stepsPerSec: number
  /** Age of the displayed state, ms (worker only). */
  latencyMs: number
}

export interface PhysicsHost {
  readonly kind: HostKind
  readonly transport: Transport | 'direct'
  /** Render-facing vehicle state (real in inline mode, a synced shadow in worker mode). */
  readonly vehicle: Vehicle
  readonly telemetry: VehicleTelemetry
  readonly stats: HostStats
  /** Interpolation factor for the last `sync()`. */
  readonly alpha: number
  setControls(c: DriverControls): void
  /** Called on the main fixed step. Inline: steps the simulation. */
  fixedUpdate(dt: number): void
  /** Called once per rendered frame before cameras/render. */
  sync(nowMs: number, loopAlpha: number): void
  command(cmd: SimCommand): void
  setPaused(paused: boolean): void
  setTimeScale(scale: number): void
  onImpact(fn: (strength: number) => void): () => void
  dispose(): void
}

abstract class HostBase {
  readonly #impact = new Set<(s: number) => void>()
  onImpact(fn: (strength: number) => void): () => void {
    this.#impact.add(fn)
    return () => this.#impact.delete(fn)
  }
  protected emitImpact(s: number): void {
    for (const fn of this.#impact) fn(s)
  }
}

export class InlineHost extends HostBase implements PhysicsHost {
  readonly kind = 'inline'
  readonly transport = 'direct'
  readonly sim: Simulation
  readonly telemetry = newTelemetry()
  readonly stats: HostStats = { physicsMs: 0, stepsPerSec: 0, latencyMs: 0 }
  alpha = 1

  constructor(cfg: SimConfig) {
    super()
    this.sim = new Simulation(cfg)
  }

  get vehicle(): Vehicle {
    return this.sim.vehicle
  }

  setControls(c: DriverControls): void {
    copyControls(c, this.sim.controls)
  }

  fixedUpdate(): void {
    // The kernel loop already applies pause/timeScale and its own fixed dt.
    const broken = this.sim.step()
    if (broken > 0) this.emitImpact(impactStrength(broken))
  }

  sync(_now: number, loopAlpha: number): void {
    this.alpha = loopAlpha
    this.sim.vehicle.telemetry(this.telemetry)
    this.stats.physicsMs = this.sim.physicsMs
    this.stats.stepsPerSec = this.sim.cfg.stepHz
  }

  command(cmd: SimCommand): void {
    this.sim.apply(cmd)
  }

  setPaused(): void {}
  setTimeScale(): void {}
  dispose(): void {}
}

export interface WorkerHostOptions {
  transport?: Transport
  clock?: ClockMode
  /** Called on dispose (e.g. worker.terminate()). */
  onDispose?: () => void
}

export const canShareMemory = (): boolean =>
  typeof SharedArrayBuffer !== 'undefined' && (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true

export class WorkerHost extends HostBase implements PhysicsHost {
  readonly kind = 'worker'
  readonly transport: Transport
  readonly vehicle: Vehicle
  readonly telemetry = newTelemetry()
  readonly stats: HostStats = { physicsMs: 0, stepsPerSec: 0, latencyMs: 0 }
  alpha = 1

  readonly #ep: Endpoint
  readonly #cfg: SimConfig
  readonly #clock: ClockMode
  readonly #L: SnapshotLayout
  readonly #dtMs: number
  readonly #meta = newMeta()
  readonly #onDispose: (() => void) | undefined
  readonly #offParams: () => void
  // shared
  #reader: TripleReader | null = null
  #slots: SnapshotSlot[] = []
  #ctrl: Int32Array | null = null
  #controls: Float32Array | null = null
  // transfer
  #latest: ArrayBuffer | null = null
  #lastControls = ''
  // manual stepping
  #stepId = 0
  readonly #pendingSteps = new Map<number, () => void>()
  #ready: Promise<void>
  #error: Error | null = null

  private constructor(ep: Endpoint, cfg: SimConfig, o: WorkerHostOptions) {
    super()
    this.#ep = ep
    this.#cfg = cfg
    this.#clock = o.clock ?? 'realtime'
    this.#onDispose = o.onDispose
    this.transport = o.transport ?? (canShareMemory() ? 'shared' : 'transfer')
    // Shadow vehicle: same deterministic builder → same topology & node order.
    this.vehicle = new Vehicle(getVehicle(cfg.vehicleId), cfg.spawn)
    this.#L = layoutFor(this.vehicle.body.nodeCount, this.vehicle.body.beamCount)
    this.#dtMs = 1000 / cfg.stepHz
    // UI edits the shadow's ParamStore; mirror them to the worker.
    this.#offParams = this.vehicle.params.subscribe((id, value) => this.command({ type: 'param', id, value }))
    ep.addEventListener('message', this.#onMessage)
    ep.start?.()
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve
      this.#rejectReady = reject
    })
    this.#init()
  }

  #resolveReady: () => void = () => {}
  #rejectReady: (e: Error) => void = () => {}

  static async create(ep: Endpoint, cfg: SimConfig, o: WorkerHostOptions = {}): Promise<WorkerHost> {
    const h = new WorkerHost(ep, cfg, o)
    await h.#ready
    h.sync(wallMs(), 1)
    return h
  }

  #post(msg: ToWorker, transfer: Transferable[] = []): void {
    this.#ep.postMessage(msg, transfer)
  }

  #init(): void {
    const L = this.#L
    if (this.transport === 'shared') {
      const state = new SharedArrayBuffer(CTRL_BYTES + 3 * L.bytes)
      const controls = new SharedArrayBuffer(CONTROLS_FLOATS * 4)
      this.#ctrl = new Int32Array(state, 0, CTRL.count)
      initTripleCell(this.#ctrl, CTRL.triple)
      this.#reader = new TripleReader(this.#ctrl, CTRL.triple)
      this.#slots = [0, 1, 2].map((i) => new SnapshotSlot(state, CTRL_BYTES + i * L.bytes, L))
      this.#controls = new Float32Array(controls)
      this.#post({ type: 'init', cfg: this.#cfg, transport: 'shared', clock: this.#clock, state, controls })
    } else {
      const buffers = [0, 1, 2].map(() => new ArrayBuffer(L.bytes))
      this.#post({ type: 'init', cfg: this.#cfg, transport: 'transfer', clock: this.#clock, buffers }, buffers)
    }
  }

  readonly #onMessage = (e: MessageEvent): void => {
    const msg = e.data as FromWorker
    switch (msg.type) {
      case 'ready':
        if (msg.nodes !== this.#L.nodes || msg.beams !== this.#L.beams) {
          this.#rejectReady(new Error('Worker body topology differs from main-thread shadow'))
        } else this.#resolveReady()
        break
      case 'state':
        if (this.#latest) this.#post({ type: 'return', buf: this.#latest }, [this.#latest])
        this.#latest = msg.buf
        break
      case 'stepped':
        this.#pendingSteps.get(msg.id)?.()
        this.#pendingSteps.delete(msg.id)
        break
      case 'impact':
        this.emitImpact(msg.strength)
        break
      case 'error':
        this.#error = new Error(`[physics worker] ${msg.message}`)
        console.error(this.#error)
        this.#rejectReady(this.#error)
        break
    }
  }

  get error(): Error | null {
    return this.#error
  }

  setControls(c: DriverControls): void {
    if (this.#controls) {
      writeControls(this.#controls, c)
      return
    }
    // Transfer transport: send only on change (cheap dedupe key).
    const key = `${c.throttle},${c.brake},${c.steer},${c.handbrake},${c.clutch}`
    if (key === this.#lastControls) return
    this.#lastControls = key
    this.#post({ type: 'controls', c: { ...c } })
  }

  fixedUpdate(): void {
    // The worker owns its clock; controls were pushed by setControls.
  }

  /** Pulls the newest snapshot (if any) into the shadow vehicle. Allocation-free on the shared path. */
  sync(nowMs: number, _loopAlpha = 1): void {
    const v = this.vehicle
    if (this.#reader) {
      if (this.#reader.acquire()) this.#slots[this.#reader.front]!.read(v, this.telemetry, this.#meta)
    } else if (this.#latest) {
      const buf = this.#latest
      this.#latest = null
      new SnapshotSlot(buf, 0, this.#L).read(v, this.telemetry, this.#meta)
      this.#post({ type: 'return', buf }, [buf])
    }
    this.stats.physicsMs = this.#meta.physicsMs
    this.stats.stepsPerSec = this.#meta.stepsPerSec
    if (this.#clock === 'manual') {
      this.alpha = 1
      this.stats.latencyMs = 0
      return
    }
    // Display one step behind: interpolate prev→pos over [t, t+dt].
    const age = nowMs - this.#meta.timeMs
    this.stats.latencyMs = age
    this.alpha = age <= 0 ? 0 : age >= this.#dtMs ? 1 : age / this.#dtMs
  }

  command(cmd: SimCommand): void {
    this.#post({ type: 'cmd', cmd })
    this.#wake()
  }

  setPaused(paused: boolean): void {
    this.#post({ type: 'pause', paused })
    this.#wake()
  }

  setTimeScale(scale: number): void {
    this.#post({ type: 'timeScale', scale })
  }

  /** Manual clock only: advance exactly `n` steps (deterministic tests). */
  step(n: number): Promise<void> {
    if (this.#clock !== 'manual') throw new Error('step() requires clock: manual')
    const id = ++this.#stepId
    return new Promise<void>((resolve) => {
      this.#pendingSteps.set(id, resolve)
      this.#post({ type: 'step', n, id })
    })
  }

  #wake(): void {
    if (this.#ctrl) {
      Atomics.store(this.#ctrl, CTRL.wake, 1)
      Atomics.notify(this.#ctrl, CTRL.wake)
    }
  }

  dispose(): void {
    this.#offParams()
    this.#post({ type: 'dispose' })
    this.#wake()
    this.#ep.removeEventListener('message', this.#onMessage)
    this.#onDispose?.()
  }
}
