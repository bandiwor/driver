/**
 * WheelSystem — per-substep chassis forces (registered as a PhysicsWorld hook):
 *   1. struts: preloaded spring + bump/rebound damper + bump stop / droop,
 *      anti-roll bars per axle; force along the hub→top-mount axis
 *   2. tyre contact: radial spring/damper → load; wheel axes from the body
 *      frame + per-wheel steer (Ackermann, toe); camber from static + roll;
 *      slip ratio / relaxed slip angle → Pacejka forces at the current ω
 *   3. driveline: engine ↔ clutch ↔ gearbox ↔ diff ↔ wheels (implicit), brakes
 *   4. final tyre forces at the new wheel speeds → applied to hub nodes
 *   5. aerodynamic drag distributed over all nodes
 * Allocation-free: all scratch lives in typed arrays created once.
 */
import type { SoftBody } from '../physics/softbody/softbody.ts'
import type { BodyFrame } from '../physics/softbody/frame.ts'
import { newGroundSample, type Ground } from '../physics/softbody/ground.ts'
import type { SubstepHook } from '../physics/softbody/world.ts'
import { engineDrive, type EngineSpec, type EngineState } from '../physics/vehicle/engine.ts'
import { gearRatio, type GearboxSpec, type GearboxState } from '../physics/vehicle/gearbox.ts'
import { newDrivelineState, solveDriveline, type DrivelineWheel } from '../physics/vehicle/driveline.ts'
import { antiRollForce, preloadedRestLength, strutForce, type StrutSpec } from '../physics/vehicle/suspension.ts'
import { slipAngle, slipRatio, tyreCoefs, tyreForces2, tyreTorqueStiffness, type TyreInput } from '../physics/vehicle/tyre.ts'
import { suspensionOf, type VehicleBody } from './build.ts'
import type { VehicleDef } from './types.ts'

const G = 9.81
const AIR_DENSITY = 1.2
/** Low-speed floors for slip (m/s): keep slips finite and damper-like at rest. */
const V0_LONG = 1
const V0_LAT = 3
/** Reference brake bias at which WheelDef.brakeTorque is specified. */
const REF_BIAS = 0.62

export interface WheelState {
  omega: number // rad/s, + = rolling forward
  angle: number // spin angle for rendering, rad
  steer: number // rad, + = left
  load: number // N
  slipRatio: number
  slipAngle: number // relaxed, rad
  compression: number // m from design ride height (+ = compressed)
  contact: boolean
  fx: number
  fy: number
}

export const newWheelState = (): WheelState => ({
  omega: 0,
  angle: 0,
  steer: 0,
  load: 0,
  slipRatio: 0,
  slipAngle: 0,
  compression: 0,
  contact: false,
  fx: 0,
  fy: 0,
})

/** Live-tunable chassis setup (derived from def + params). */
export interface ChassisSetup {
  struts: StrutSpec[]
  antiRoll: { front: number; rear: number }
  /** Static camber per wheel as lean toward +lateral (left), rad. */
  camberLean: number[]
  /** Static toe per wheel, rad, + = toe-in. */
  toe: number[]
  pressure: number[]
  /** Peak tyre μ (replaces tyre.D). */
  grip: number
  brakeForce: number
  brakeBias: number
  frontSplit: number
  diffLock: number
  maxSteer: number
  ackermann: number
}

/** Driver/automation state for the current fixed step (set by Vehicle.preStep). */
export interface ChassisInput {
  throttle: number
  brake: number
  handbrake: number
  /** Clutch engagement 0..1 (auto clutch × pedal). */
  clutch: number
  /** Starter motor engaged (ignition key held). */
  starter: number
  /** Automated gearbox cuts the throttle while a shift is in progress. */
  cutThrottle: boolean
}

export class WheelSystem implements SubstepHook {
  readonly wheels: WheelState[]
  readonly setup: ChassisSetup
  readonly input: ChassisInput = { throttle: 0, brake: 0, handbrake: 0, clutch: 1, starter: 0, cutThrottle: false }
  readonly driveline = newDrivelineState(0)
  readonly wheelbase: number
  readonly nominalLoad: Float64Array
  /** [left, right] wheel indices per axle. */
  readonly axleFront: readonly [number, number]
  readonly axleRear: readonly [number, number]
  ground: Ground

  readonly #def: VehicleDef
  readonly #vb: VehicleBody
  readonly #body: SoftBody
  readonly #frame: BodyFrame
  readonly #engineSpec: EngineSpec
  readonly #engine: EngineState
  readonly #gbSpec: GearboxSpec
  readonly #gb: GearboxState
  readonly #dl: DrivelineWheel[]
  readonly #axles: [number, number, number][]
  readonly #massTotal: number
  // per-wheel scratch
  readonly #len: Float64Array
  readonly #n: Float64Array // strut unit axis ×3
  readonly #vrel: Float64Array
  readonly #ax: Float64Array // fw(3) lat(3) N(3) vx camber mu → 12
  readonly #gs = newGroundSample()
  readonly #ti: TyreInput = { slipRatio: 0, slipAngle: 0, load: 0, nominalLoad: 0, surfaceMu: 1, camber: 0, pressure: 230 }
  readonly #tf = { fx: 0, fy: 0 }
  readonly #tc = { B: 0, D: 0 }

  constructor(
    def: VehicleDef,
    vb: VehicleBody,
    frame: BodyFrame,
    ground: Ground,
    engine: { spec: EngineSpec; state: EngineState },
    gearbox: { spec: GearboxSpec; state: GearboxState },
  ) {
    this.#def = def
    this.#vb = vb
    this.#body = vb.body
    this.#frame = frame
    this.ground = ground
    this.#engineSpec = engine.spec
    this.#engine = engine.state
    this.#gbSpec = gearbox.spec
    this.#gb = gearbox.state
    const n = def.wheels.length
    this.wheels = def.wheels.map(() => newWheelState())
    this.#len = new Float64Array(n)
    this.#n = new Float64Array(n * 3)
    this.#vrel = new Float64Array(n)
    this.#ax = new Float64Array(n * 12)
    const pair = (axle: 'front' | 'rear'): [number, number] => {
      const l = def.wheels.findIndex((w) => w.axle === axle && w.x > 0)
      const r = def.wheels.findIndex((w) => w.axle === axle && w.x < 0)
      if (l < 0 || r < 0) throw new Error(`${def.id}: ${axle} axle needs a left and a right wheel`)
      return [l, r]
    }
    this.axleFront = pair('front')
    this.axleRear = pair('rear')
    const zf = def.wheels[this.axleFront[0]]!.z
    const zr = def.wheels[this.axleRear[0]]!.z
    this.wheelbase = zf - zr

    // Static load distribution from the design centre of mass.
    const b = vb.body
    let m = 0
    let mz = 0
    for (let i = 0; i < b.nodeCount; i++) {
      const mi = 1 / b.invMass[i]!
      m += mi
      mz += mi * b.pos[i * 3 + 2]!
    }
    this.#massTotal = m
    const frontShare = Math.min(0.8, Math.max(0.2, (mz / m - zr) / this.wheelbase))
    this.nominalLoad = Float64Array.from(def.wheels, (w) => (m * G * (w.axle === 'front' ? frontShare : 1 - frontShare)) / 2)

    this.setup = {
      struts: def.wheels.map((w, i) => {
        const s = suspensionOf(def, w)
        const c = vb.corners[i]!
        const design = dist(b.pos, c.hub, c.top)
        return {
          spring: s.spring,
          damperBump: s.damperBump,
          damperRebound: s.damperRebound,
          designLength: design,
          restLength: preloadedRestLength(design, this.#sprungLoad(i), s.spring),
          compressionTravel: s.travel,
          droopTravel: s.droop,
          bumpStopRate: s.spring * 12,
        }
      }),
      antiRoll: { front: def.suspensionFront.antiRoll, rear: def.suspensionRear.antiRoll },
      camberLean: def.wheels.map((w) => Math.sign(w.x) * suspensionOf(def, w).camber),
      toe: def.wheels.map((w) => suspensionOf(def, w).toe),
      pressure: def.wheels.map(() => def.tyre.pressure),
      grip: def.tyre.D,
      brakeForce: 1,
      brakeBias: REF_BIAS,
      frontSplit: def.drivetrain.frontSplit,
      diffLock: def.drivetrain.diffLock,
      maxSteer: def.maxSteer,
      ackermann: def.ackermann,
    }
    this.#dl = def.wheels.map(() => ({
      omega: 0,
      inertia: def.wheelInertia,
      k: 0,
      fx: 0,
      radius: def.tyre.radius,
      share: 0,
      brake: 0,
      a: 0,
      b: 0,
    }))
    this.#axles = [
      [this.axleFront[0], this.axleFront[1], 0],
      [this.axleRear[0], this.axleRear[1], 0],
    ]
    this.applySetup()
  }

  #sprungLoad(i: number): number {
    return this.nominalLoad[i]! - this.#def.wheelMass * G
  }

  /** Re-derive drive shares and diff couplings (call after setup edits). */
  applySetup(): void {
    const s = this.setup
    const split = Math.min(1, Math.max(0, s.frontSplit))
    const lockC = s.diffLock >= 0.999 ? Infinity : (600 * s.diffLock) / (1 - s.diffLock)
    this.#def.wheels.forEach((w, i) => {
      this.#dl[i]!.share = (w.axle === 'front' ? split : 1 - split) / 2
    })
    this.#axles[0]![2] = split > 0 ? lockC : 0
    this.#axles[1]![2] = split < 1 ? lockC : 0
  }

  /** Change spring rate while keeping the ride height (re-preload). */
  setSpring(i: number, k: number): void {
    const st = this.setup.struts[i]!
    st.spring = k
    st.restLength = preloadedRestLength(st.designLength, this.#sprungLoad(i), k)
    st.bumpStopRate = k * 12
  }

  /** Whether wheel i receives drive torque. */
  driven(i: number): boolean {
    return this.#dl[i]!.share > 0
  }

  /** Carrier speed (rad/s): driven wheel speeds weighted by torque share. */
  carrierOmega(): number {
    let c = 0
    for (const d of this.#dl) c += d.share * d.omega
    return c
  }

  reset(): void {
    for (const w of this.wheels) Object.assign(w, newWheelState())
    for (const d of this.#dl) d.omega = 0
    this.driveline.clutchTorque = 0
    this.driveline.locked = false
  }

  #brakeTorque(i: number): number {
    const w = this.#def.wheels[i]!
    const s = this.setup
    const bias = w.axle === 'front' ? s.brakeBias / REF_BIAS : (1 - s.brakeBias) / (1 - REF_BIAS)
    let t = this.input.brake * w.brakeTorque * s.brakeForce * bias
    if (w.axle === 'rear') t += this.input.handbrake * this.#def.handbrakeTorque
    return t
  }

  preSubstep(h: number): void {
    const body = this.#body
    const { pos, vel, force } = body
    const f = this.#frame
    const def = this.#def
    const corners = this.#vb.corners
    const nw = this.wheels.length
    const tyre = def.tyre
    const R = tyre.radius
    const setup = this.setup
    // Body lateral (left) axis = up × forward.
    const lx = f.uy * f.fz - f.uz * f.fy
    const ly = f.uz * f.fx - f.ux * f.fz
    const lz = f.ux * f.fy - f.uy * f.fx

    // ── 1. struts + anti-roll bars ─────────────────────────────
    for (let i = 0; i < nw; i++) {
      const c = corners[i]!
      const h3 = c.hub * 3
      const t3 = c.top * 3
      const dx = pos[t3]! - pos[h3]!
      const dy = pos[t3 + 1]! - pos[h3 + 1]!
      const dz = pos[t3 + 2]! - pos[h3 + 2]!
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz)
      const inv = 1 / L
      const nx = dx * inv
      const ny = dy * inv
      const nz = dz * inv
      this.#len[i] = L
      this.#n[i * 3] = nx
      this.#n[i * 3 + 1] = ny
      this.#n[i * 3 + 2] = nz
      this.#vrel[i] = (vel[t3]! - vel[h3]!) * nx + (vel[t3 + 1]! - vel[h3 + 1]!) * ny + (vel[t3 + 2]! - vel[h3 + 2]!) * nz
      this.wheels[i]!.compression = setup.struts[i]!.designLength - L
    }
    for (let i = 0; i < nw; i++) {
      const F = strutForce(setup.struts[i]!, this.#len[i]!, this.#vrel[i]!) + this.#arb(i)
      const c = corners[i]!
      const h3 = c.hub * 3
      const t3 = c.top * 3
      const fx = F * this.#n[i * 3]!
      const fy = F * this.#n[i * 3 + 1]!
      const fz = F * this.#n[i * 3 + 2]!
      force[h3] = force[h3]! - fx
      force[h3 + 1] = force[h3 + 1]! - fy
      force[h3 + 2] = force[h3 + 2]! - fz
      force[t3] = force[t3]! + fx
      force[t3 + 1] = force[t3 + 1]! + fy
      force[t3 + 2] = force[t3 + 2]! + fz
    }

    // ── 2. tyre contact + forces at the current ω ──────────────
    const gs = this.#gs
    const ti = this.#ti
    const tf = this.#tf
    const ax = this.#ax
    for (let i = 0; i < nw; i++) {
      const w = this.wheels[i]!
      const dl = this.#dl[i]!
      const h3 = corners[i]!.hub * 3
      const vx0 = vel[h3]!
      const vy0 = vel[h3 + 1]!
      const vz0 = vel[h3 + 2]!
      this.ground.sample(pos[h3]!, pos[h3 + 2]!, gs)
      const Nx = gs.nx
      const Ny = gs.ny
      const Nz = gs.nz
      const pen = R - (pos[h3 + 1]! - gs.height) * Ny
      let load = 0
      if (pen > 0) {
        const vn = vx0 * Nx + vy0 * Ny + vz0 * Nz
        const pr = setup.pressure[i]! / tyre.pressure
        load = Math.max(0, tyre.radialStiffness * pr * pen - tyre.radialDamping * vn)
      }
      w.contact = load > 0
      w.load = load
      // Steered forward projected on the ground plane; lateral = N × fw.
      const cs = Math.cos(w.steer)
      const sn = Math.sin(w.steer)
      let fwx = f.fx * cs + lx * sn
      let fwy = f.fy * cs + ly * sn
      let fwz = f.fz * cs + lz * sn
      const fn = fwx * Nx + fwy * Ny + fwz * Nz
      fwx -= fn * Nx
      fwy -= fn * Ny
      fwz -= fn * Nz
      const fl = Math.sqrt(fwx * fwx + fwy * fwy + fwz * fwz) || 1
      fwx /= fl
      fwy /= fl
      fwz /= fl
      const ltx = Ny * fwz - Nz * fwy
      const lty = Nz * fwx - Nx * fwz
      const ltz = Nx * fwy - Ny * fwx
      const vx = vx0 * fwx + vy0 * fwy + vz0 * fwz
      const vy = vx0 * ltx + vy0 * lty + vz0 * ltz
      // Camber lean = static + body roll (up tilting toward +lateral).
      const camber = setup.camberLean[i]! + (f.ux * ltx + f.uy * lty + f.uz * ltz)
      // Relaxation length: first-order lag of the slip angle.
      const relax = Math.min(1, (h * Math.max(Math.abs(vx), V0_LAT)) / tyre.relaxationLength)
      w.slipAngle += (slipAngle(vx, vy, V0_LAT) - w.slipAngle) * relax
      const mu = (gs.friction * setup.grip) / tyre.D
      this.#tyreInput(i, slipRatio(dl.omega, R, vx, V0_LONG), w.slipAngle, load, mu, camber)
      tyreForces2(tyre, ti, tf)
      tyreCoefs(tyre, ti, this.#tc)
      dl.fx = tf.fx
      dl.k = load > 0 ? tyreTorqueStiffness(tyre, load, this.#tc.D, this.#tc.B, vx, V0_LONG) : 0
      dl.brake = this.#brakeTorque(i)
      const a = i * 12
      ax[a] = fwx
      ax[a + 1] = fwy
      ax[a + 2] = fwz
      ax[a + 3] = ltx
      ax[a + 4] = lty
      ax[a + 5] = ltz
      ax[a + 6] = Nx
      ax[a + 7] = Ny
      ax[a + 8] = Nz
      ax[a + 9] = vx
      ax[a + 10] = camber
      ax[a + 11] = mu
    }

    // ── 3. driveline (implicit) ────────────────────────────────
    const eng = this.#engine
    const shifting = this.#gb.shiftTimer > 0
    const inp = this.input
    const te = engineDrive(this.#engineSpec, eng, shifting && inp.cutThrottle ? 0 : inp.throttle, inp.starter, h)
    this.driveline.engineOmega = eng.omega
    solveDriveline(
      {
        h,
        engineTorque: te,
        engineInertia: this.#engineSpec.inertia,
        ratio: shifting ? 0 : gearRatio(this.#gbSpec, this.#gb.gear),
        clutchCapacity: this.#gbSpec.clutchMaxTorque * this.input.clutch,
      },
      this.#dl,
      this.#axles,
      this.driveline,
    )
    eng.omega = this.driveline.engineOmega

    // ── 4. final tyre forces at the new wheel speeds → hubs ────
    for (let i = 0; i < nw; i++) {
      const w = this.wheels[i]!
      const dl = this.#dl[i]!
      w.omega = dl.omega
      w.angle = (w.angle + dl.omega * h) % (Math.PI * 2)
      if (w.load <= 0) {
        w.fx = 0
        w.fy = 0
        w.slipRatio = 0
        continue
      }
      const a = i * 12
      const vx = ax[a + 9]!
      const sr = slipRatio(dl.omega, R, vx, V0_LONG)
      this.#tyreInput(i, sr, w.slipAngle, w.load, ax[a + 11]!, ax[a + 10]!)
      tyreForces2(tyre, ti, tf)
      const Fx = tf.fx - tyre.rollingResistance * w.load * Math.tanh(vx * 2)
      const Fy = tf.fy
      w.fx = Fx
      w.fy = Fy
      w.slipRatio = sr
      const h3 = corners[i]!.hub * 3
      force[h3] = force[h3]! + ax[a]! * Fx + ax[a + 3]! * Fy + ax[a + 6]! * w.load
      force[h3 + 1] = force[h3 + 1]! + ax[a + 1]! * Fx + ax[a + 4]! * Fy + ax[a + 7]! * w.load
      force[h3 + 2] = force[h3 + 2]! + ax[a + 2]! * Fx + ax[a + 5]! * Fy + ax[a + 8]! * w.load
    }

    // ── 5. aerodynamic drag (uniform deceleration of all nodes) ─
    const v2 = f.vx * f.vx + f.vy * f.vy + f.vz * f.vz
    if (v2 > 0.01) {
      const k = (-0.5 * AIR_DENSITY * def.dragArea * Math.sqrt(v2)) / this.#massTotal
      const adx = k * f.vx
      const ady = k * f.vy
      const adz = k * f.vz
      const im = body.invMass
      for (let n = 0; n < body.nodeCount; n++) {
        const m = 1 / im[n]!
        force[n * 3] = force[n * 3]! + adx * m
        force[n * 3 + 1] = force[n * 3 + 1]! + ady * m
        force[n * 3 + 2] = force[n * 3 + 2]! + adz * m
      }
    }
  }

  #tyreInput(i: number, sr: number, sa: number, load: number, mu: number, camber: number): void {
    const ti = this.#ti
    ti.slipRatio = sr
    ti.slipAngle = sa
    ti.load = load
    ti.nominalLoad = this.nominalLoad[i]!
    ti.surfaceMu = mu
    ti.camber = camber
    ti.pressure = this.setup.pressure[i]!
  }

  #arb(i: number): number {
    const [fl, fr] = this.axleFront
    const [rl, rr] = this.axleRear
    const ar = this.setup.antiRoll
    const w = this.wheels
    if (i === fl || i === fr) {
      const f = antiRollForce(ar.front, w[fl]!.compression, w[fr]!.compression)
      return i === fl ? f : -f
    }
    if (i === rl || i === rr) {
      const f = antiRollForce(ar.rear, w[rl]!.compression, w[rr]!.compression)
      return i === rl ? f : -f
    }
    return 0
  }
}

const dist = (p: Float64Array, a: number, b: number): number =>
  Math.hypot(p[b * 3]! - p[a * 3]!, p[b * 3 + 1]! - p[a * 3 + 1]!, p[b * 3 + 2]! - p[a * 3 + 2]!)
