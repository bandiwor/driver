/**
 * Main ⇄ physics-worker message protocol. Transport-agnostic `Endpoint`
 * (Worker, DedicatedWorkerGlobalScope, MessagePort) so tests can run the
 * server in-process over a MessageChannel.
 */
import type { DriverControls } from '../input/input.ts'
import type { SimCommand, SimConfig } from './simulation.ts'

/** shared = SharedArrayBuffer triple buffer; transfer = pooled ArrayBuffers via postMessage. */
export type Transport = 'shared' | 'transfer'
/** realtime = worker runs its own fixed-step clock; manual = steps on request (tests). */
export type ClockMode = 'realtime' | 'manual'

export interface InitMsg {
  type: 'init'
  cfg: SimConfig
  transport: Transport
  clock: ClockMode
  /** shared: [ctrl Int32×4 | slot0 | slot1 | slot2] */
  state?: SharedArrayBuffer
  /** shared: Float32×8 latest driver controls */
  controls?: SharedArrayBuffer
  /** transfer: pooled slot buffers */
  buffers?: ArrayBuffer[]
}

export type ToWorker =
  | InitMsg
  | { type: 'controls'; c: DriverControls }
  | { type: 'cmd'; cmd: SimCommand }
  | { type: 'pause'; paused: boolean }
  | { type: 'timeScale'; scale: number }
  | { type: 'step'; n: number; id: number }
  | { type: 'return'; buf: ArrayBuffer }
  | { type: 'dispose' }

export type FromWorker =
  | { type: 'ready'; nodes: number; beams: number }
  | { type: 'state'; buf: ArrayBuffer }
  | { type: 'stepped'; id: number }
  | { type: 'impact'; strength: number }
  | { type: 'error'; message: string }

export interface Endpoint {
  postMessage(message: unknown, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (e: MessageEvent) => void): void
  start?(): void
}

/** Shared-state header: Int32 cells before the slots. */
export const CTRL = {
  triple: 0, // triple-buffer middle cell
  wake: 1, // Atomics.wait/notify cell for the worker clock
  count: 4,
} as const
export const CTRL_BYTES = CTRL.count * 4 + 8 // keep slots 8-aligned (f64 header)

export const CONTROLS_FLOATS = 8

export const writeControls = (f: Float32Array, c: DriverControls): void => {
  f[0] = c.throttle
  f[1] = c.brake
  f[2] = c.steer
  f[3] = c.handbrake
  f[4] = c.clutch
}

export const readControls = (f: Float32Array, c: DriverControls): void => {
  c.throttle = f[0]!
  c.brake = f[1]!
  c.steer = f[2]!
  c.handbrake = f[3]!
  c.clutch = f[4]!
}

/** Absolute wall time comparable across threads (performance.now origins differ). */
export const wallMs = (): number => performance.timeOrigin + performance.now()
