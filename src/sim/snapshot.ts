/**
 * Binary state snapshot produced by the simulation each published tick and
 * consumed by the renderer/UI. One contiguous byte range per slot:
 *
 *   f64 header  [seq, timeMs (absolute, timeOrigin-based), simTime, afterfires, blowOffs]
 *               (event counters are f64: exact integers, never wrap)
 *   f32 scalars [telemetry …, frame (12)]
 *   f32 pos     nodes·3   — state after the last step
 *   f32 prev    nodes·3   — state before the last step (render interpolation)
 *   f32 wheels  wheels·11 — ω, spin angle, steer, load, slip ratio, slip angle, compression,
 *                           contact, slip speed, surface, detached
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
  running: 21,
  clutch: 22,
  automatic: 23,
  grind: 24,
  turbo: 25,
  boost: 26,
  turboSpin: 27,
  lambda: 28,
  egt: 29,
  smoke: 30,
  soot: 31,
  afterfireStrength: 32,
  engineHealth: 33,
  wheelsOff: 34,
  count: 36,
} as const

const FRAME_KEYS = ['px', 'py', 'pz', 'fx', 'fy', 'fz', 'ux', 'uy', 'uz', 'vx', 'vy', 'vz'] as const satisfies readonly (keyof BodyFrame)[]

export const WHEEL_FLOATS = 11
const HEAD = 5

export interface SnapshotLayout {
  readonly nodes: number
  readonly beams: number
  readonly wheels: number
  readonly wheelsOff: number
  readonly scalarsOff: number
  readonly posOff: number
  readonly prevOff: number
  readonly flagsOff: number
  /** Slot size in bytes (multiple of 8). */
  readonly bytes: number
}

const align8 = (n: number): number => Math.ceil(n / 8) * 8

export function layoutFor(nodes: number, beams: number, wheels = 0): SnapshotLayout {
  const scalarsOff = HEAD * 8
  const posOff = scalarsOff + S.count * 4
  const prevOff = posOff + nodes * 12
  const wheelsOff = prevOff + nodes * 12
  const flagsOff = wheelsOff + wheels * WHEEL_FLOATS * 4
  return { nodes, beams, wheels, scalarsOff, posOff, prevOff, wheelsOff, flagsOff, bytes: align8(flagsOff + beams) }
}

export const layoutForVehicle = (v: Vehicle): SnapshotLayout =>
  layoutFor(v.body.nodeCount, v.body.beamCount, v.wheels.length)

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
  readonly wheels: Float32Array
  readonly flags: Uint8Array

  constructor(buf: ArrayBufferLike, offset: number, readonly L: SnapshotLayout) {
    this.head = new Float64Array(buf, offset, HEAD)
    this.scalars = new Float32Array(buf, offset + L.scalarsOff, S.count)
    this.pos = new Float32Array(buf, offset + L.posOff, L.nodes * 3)
    this.prev = new Float32Array(buf, offset + L.prevOff, L.nodes * 3)
    this.wheels = new Float32Array(buf, offset + L.wheelsOff, L.wheels * WHEEL_FLOATS)
    this.flags = new Uint8Array(buf, offset + L.flagsOff, L.beams)
  }

  write(sim: Simulation, seq: number, timeMs: number, stepsPerSec: number, tel: VehicleTelemetry): void {
    const v = sim.vehicle
    const s = this.scalars
    v.telemetry(tel)
    this.head[0] = seq
    this.head[1] = timeMs
    this.head[2] = sim.world.time
    this.head[3] = tel.afterfires
    this.head[4] = tel.blowOffs
    s[S.speedKmh] = tel.speedKmh
    s[S.rpm] = tel.rpm
    s[S.gear] = encodeGear(tel.gear)
    s[S.throttle] = tel.throttle
    s[S.load] = tel.load
    s[S.damage] = tel.damage
    s[S.limiter] = tel.limiter ? 1 : 0
    s[S.physicsMs] = sim.physicsMs
    s[S.stepsPerSec] = stepsPerSec
    s[S.running] = tel.running ? 1 : 0
    s[S.clutch] = tel.clutch
    s[S.automatic] = tel.automatic ? 1 : 0
    s[S.grind] = tel.grind ? 1 : 0
    s[S.turbo] = tel.turbo ? 1 : 0
    s[S.boost] = tel.boost
    s[S.turboSpin] = tel.turboSpin
    s[S.lambda] = tel.lambda
    s[S.egt] = tel.egt
    s[S.smoke] = tel.smoke
    s[S.soot] = tel.soot
    s[S.afterfireStrength] = tel.afterfireStrength
    s[S.engineHealth] = tel.engineHealth
    s[S.wheelsOff] = tel.wheelsOff
    const f = v.frame
    for (let i = 0; i < 12; i++) s[S.frame + i] = f[FRAME_KEYS[i]!]
    this.pos.set(v.body.pos)
    this.prev.set(v.prevPos)
    this.flags.set(v.body.flags)
    const wf = this.wheels
    const ws = v.wheels
    for (let i = 0; i < this.L.wheels; i++) {
      const w = ws[i]!
      const o = i * WHEEL_FLOATS
      wf[o] = w.omega
      wf[o + 1] = w.angle
      wf[o + 2] = w.steer
      wf[o + 3] = w.load
      wf[o + 4] = w.slipRatio
      wf[o + 5] = w.slipAngle
      wf[o + 6] = w.compression
      wf[o + 7] = w.contact ? 1 : 0
      wf[o + 8] = w.slipSpeed
      wf[o + 9] = w.surface
      wf[o + 10] = w.detached ? 1 : 0
    }
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
    tel.running = s[S.running]! > 0.5
    tel.clutch = s[S.clutch]!
    tel.automatic = s[S.automatic]! > 0.5
    tel.grind = s[S.grind]! > 0.5
    tel.turbo = s[S.turbo]! > 0.5
    tel.boost = s[S.boost]!
    tel.turboSpin = s[S.turboSpin]!
    tel.lambda = s[S.lambda]!
    tel.egt = s[S.egt]!
    tel.smoke = s[S.smoke]!
    tel.soot = s[S.soot]!
    tel.afterfireStrength = s[S.afterfireStrength]!
    tel.engineHealth = s[S.engineHealth]!
    tel.wheelsOff = s[S.wheelsOff]!
    tel.afterfires = this.head[3]!
    tel.blowOffs = this.head[4]!
    const f = v.frame
    for (let i = 0; i < 12; i++) f[FRAME_KEYS[i]!] = s[S.frame + i]!
    v.body.pos.set(this.pos)
    v.prevPos.set(this.prev)
    v.body.flags.set(this.flags)
    const wf = this.wheels
    const ws = v.wheels
    for (let i = 0; i < this.L.wheels; i++) {
      const w = ws[i]!
      const o = i * WHEEL_FLOATS
      w.omega = wf[o]!
      w.angle = wf[o + 1]!
      w.steer = wf[o + 2]!
      w.load = wf[o + 3]!
      w.slipRatio = wf[o + 4]!
      w.slipAngle = wf[o + 5]!
      w.compression = wf[o + 6]!
      w.contact = wf[o + 7]! > 0.5
      w.slipSpeed = wf[o + 8]!
      w.surface = wf[o + 9]!
      w.detached = wf[o + 10]! > 0.5
    }
  }
}

export const newMeta = (): SnapshotMeta => ({ seq: -1, timeMs: 0, simTime: 0, physicsMs: 0, stepsPerSec: 0 })
