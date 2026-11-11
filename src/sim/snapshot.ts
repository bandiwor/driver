/**
 * Binary state snapshot produced by the simulation each published tick and
 * consumed by the renderer/UI. One contiguous byte range per slot:
 *
 *   f64 header  [seq, timeMs (absolute, timeOrigin-based), simTime]
 *   f32 scalars [telemetry …, frame (12)]
 *   f32 pos     nodes·3   — state after the last step
 *   f32 prev    nodes·3   — state before the last step (render interpolation)
 *   u8  flags   beams     — beam flags (broken bits)
 *
 * Views are created once per slot; reading/writing allocates nothing.
 */
import type { BodyFrame } from '../physics/softbody/frame.ts'
import type { Simulation } from './simulation.ts'
import type { Vehicle, VehicleTelemetry } from '../vehicles/runtime.ts'

export const S = {
  speedKmh: 0,
  rpm: 1,
  gear: 2,
  throttle: 3,
  load: 4,
  damage: 5,
  limiter: 6,
  physicsMs: 7,
  stepsPerSec: 8,
  frame: 9, // 12 floats: p, f, u, v
  count: 24,
} as const

const FRAME_KEYS = ['px', 'py', 'pz', 'fx', 'fy', 'fz', 'ux', 'uy', 'uz', 'vx', 'vy', 'vz'] as const satisfies readonly (keyof BodyFrame)[]

export interface SnapshotLayout {
  readonly nodes: number
  readonly beams: number
  readonly scalarsOff: number
  readonly posOff: number
  readonly prevOff: number
  readonly flagsOff: number
  /** Slot size in bytes (multiple of 8). */
  readonly bytes: number
}

const align8 = (n: number): number => Math.ceil(n / 8) * 8

export function layoutFor(nodes: number, beams: number): SnapshotLayout {
  const scalarsOff = 3 * 8
  const posOff = scalarsOff + S.count * 4
  const prevOff = posOff + nodes * 12
  const flagsOff = prevOff + nodes * 12
  return { nodes, beams, scalarsOff, posOff, prevOff, flagsOff, bytes: align8(flagsOff + beams) }
}

/** Gear label <-> number encoding for the f32 block. */
export const encodeGear = (label: string): number => (label === 'R' ? -1 : label === 'N' ? 0 : Number(label))
export const decodeGear = (g: number): string => (g < 0 ? 'R' : g === 0 ? 'N' : String(g))

export interface SnapshotMeta {
  seq: number
  timeMs: number
  simTime: number
  physicsMs: number
  stepsPerSec: number
}

export class SnapshotSlot {
  readonly head: Float64Array
  readonly scalars: Float32Array
  readonly pos: Float32Array
  readonly prev: Float32Array
  readonly flags: Uint8Array

  constructor(buf: ArrayBufferLike, offset: number, readonly L: SnapshotLayout) {
    this.head = new Float64Array(buf, offset, 3)
    this.scalars = new Float32Array(buf, offset + L.scalarsOff, S.count)
    this.pos = new Float32Array(buf, offset + L.posOff, L.nodes * 3)
    this.prev = new Float32Array(buf, offset + L.prevOff, L.nodes * 3)
    this.flags = new Uint8Array(buf, offset + L.flagsOff, L.beams)
  }

  write(sim: Simulation, seq: number, timeMs: number, stepsPerSec: number, tel: VehicleTelemetry): void {
    const v = sim.vehicle
    const s = this.scalars
    v.telemetry(tel)
    this.head[0] = seq
    this.head[1] = timeMs
    this.head[2] = sim.world.time
    s[S.speedKmh] = tel.speedKmh
    s[S.rpm] = tel.rpm
    s[S.gear] = encodeGear(tel.gear)
    s[S.throttle] = tel.throttle
    s[S.load] = tel.load
    s[S.damage] = tel.damage
    s[S.limiter] = tel.limiter ? 1 : 0
    s[S.physicsMs] = sim.physicsMs
    s[S.stepsPerSec] = stepsPerSec
    const f = v.frame
    for (let i = 0; i < 12; i++) s[S.frame + i] = f[FRAME_KEYS[i]!]
    this.pos.set(v.body.pos)
    this.prev.set(v.prevPos)
    this.flags.set(v.body.flags)
  }

  /** Copies the snapshot into a (shadow) vehicle + telemetry. */
  read(v: Vehicle, tel: VehicleTelemetry, meta: SnapshotMeta): void {
    const s = this.scalars
    meta.seq = this.head[0]!
    meta.timeMs = this.head[1]!
    meta.simTime = this.head[2]!
    meta.physicsMs = s[S.physicsMs]!
    meta.stepsPerSec = s[S.stepsPerSec]!
    tel.speedKmh = s[S.speedKmh]!
    tel.rpm = s[S.rpm]!
    tel.gear = decodeGear(s[S.gear]!)
    tel.throttle = s[S.throttle]!
    tel.load = s[S.load]!
    tel.damage = s[S.damage]!
    tel.limiter = s[S.limiter]! > 0.5
    const f = v.frame
    for (let i = 0; i < 12; i++) f[FRAME_KEYS[i]!] = s[S.frame + i]!
    v.body.pos.set(this.pos)
    v.prevPos.set(this.prev)
    v.body.flags.set(this.flags)
  }
}

export const newMeta = (): SnapshotMeta => ({ seq: -1, timeMs: 0, simTime: 0, physicsMs: 0, stepsPerSec: 0 })
