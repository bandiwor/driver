/**
 * Runtime vehicle instance: soft body + chassis (wheels, suspension,
 * driveline) + powertrain state + tunable params. Pure simulation (no
 * three.js / DOM): runs in tests, snapshot mode and inside the physics worker.
 * On the main thread in worker mode the same class is a read-only "shadow"
 * whose state is overwritten from snapshots.
 *
 * Per fixed step:  preStep (driver aids: auto gearbox, auto clutch, reverse,
 * steering, brakes) → world substeps (WheelSystem hook) → postStep (frame).
 */
import { ParamStore } from '../core/params.ts'
import { clamp, RADS_TO_RPM, smoothstep } from '../core/math/scalar.ts'
import { computeFrame, newFrame, type BodyFrame } from '../physics/softbody/frame.ts'
import { BeamFlag, centerOfMass, damage, resetBody } from '../physics/softbody/softbody.ts'
import { FlatGround, type Ground } from '../physics/softbody/ground.ts'
import { engineRpm, newEngineState, type EngineSpec, type EngineState } from '../physics/vehicle/engine.ts'

/** World placement: position of the design origin + heading (0 = +z). */
export interface VehiclePose {
  x: number
  y: number
  z: number
  yaw: number
}
export const pose = (x = 0, y = 0, z = 0, yaw = 0): VehiclePose => ({ x, y, z, yaw })
import { gearLabel, gearRatio, newGearboxState, shift, type GearboxSpec, type GearboxState } from '../physics/vehicle/gearbox.ts'
import { curve, sample } from '../physics/vehicle/curve.ts'
import { wheelSteerAngle } from '../physics/vehicle/steering.ts'
import type { DriverControls } from '../input/input.ts'
import { buildVehicleBody, type VehicleBody } from './build.ts'
import { WheelSystem, type WheelState } from './wheels.ts'
import { EnginePipeline } from '../physics/vehicle/powerplant.ts'
import type { VehicleDef } from './types.ts'

const DEG = Math.PI / 180
/** Minimum time between automatic shifts, s. */
const AUTO_SHIFT_COOLDOWN = 0.7
/** Hold brake at standstill this long to select reverse (automatic), s. */
const REVERSE_HOLD = 0.25
/** Manual gear lever travel time (box in neutral meanwhile), s. */
const LEVER_TIME = 0.12
/** How long the "gears grinding" feedback stays on, s. */
const GRIND_TIME = 0.7

/**
 * Clutch pedal → engagement. Free play at both ends, bite zone in between
 * (0 = pedal released = fully engaged).
 */
export const clutchEngagement = (pedal: number): number => 1 - smoothstep(0.2, 0.8, pedal)

export interface VehicleTelemetry {
  speedKmh: number
  rpm: number
  gear: string
  throttle: number
  load: number
  damage: number
  limiter: boolean
  /** Engine running (false = stalled). */
  running: boolean
  /** Clutch engagement 0..1 (1 = fully engaged). */
  clutch: number
  automatic: boolean
  /** Gear change refused (clutch not pressed / wrong direction). */
  grind: boolean
  /** Turbo: fitted+enabled, boost (bar), shaft speed 0..1. */
  turbo: boolean
  boost: number
  turboSpin: number
  lambda: number
  /** Exhaust gas temperature, °C. */
  egt: number
  /** Tailpipe smoke amount 0..1 and darkness 0..1. */
  smoke: number
  soot: number
  /** Monotonic event counters (consumers diff them) + last pop strength. */
  afterfires: number
  afterfireStrength: number
  blowOffs: number
  /** Engine mechanical health 0..1 (crash damage to the engine bay). */
  engineHealth: number
  /** Number of torn-off wheels. */
  wheelsOff: number
}

export class Vehicle {
  readonly def: VehicleDef
  readonly params: ParamStore
  readonly vb: VehicleBody
  readonly frame: BodyFrame = newFrame()
  /** Node positions at the previous fixed step (render interpolation). */
  readonly prevPos: Float64Array
  readonly engineSpec: EngineSpec
  readonly gearboxSpec: GearboxSpec
  readonly engine: EngineState
  readonly gearbox: GearboxState = newGearboxState()
  readonly chassis: WheelSystem
  /** Combustion pipeline (fuel, ignition, exhaust, turbo, … modules). */
  readonly powerplant: EnginePipeline
  /** Centre of mass in body-local coordinates (frame origin offset). */
  readonly comLocal: readonly [number, number, number]
  automatic: boolean

  readonly #shellSpring0: Float64Array
  /** Design (body-local) node positions, for placing the car anywhere. */
  readonly #design: Float64Array
  /** Shell beams of the engine bay (ahead of the front axle). */
  readonly #bay: Uint32Array
  #healthTimer = 0
  #autoCooldown = 0
  #reverseHold = 0
  #grind = 0

  constructor(def: VehicleDef, at: VehiclePose = pose(), ground: Ground = new FlatGround(0)) {
    this.def = def
    this.params = new ParamStore(def.params)
    this.vb = buildVehicleBody(def)
    const c = centerOfMass(this.vb.body)
    this.comLocal = [c[0]!, c[1]!, c[2]!]
    this.#shellSpring0 = this.vb.body.spring.slice(0, this.vb.shellBeams)
    this.engineSpec = { ...def.engine }
    this.gearboxSpec = { ...def.gearbox }
    this.engine = newEngineState(this.engineSpec)
    this.powerplant = new EnginePipeline(def.powerplant)
    // Wheel system is built at the design pose (static loads, strut lengths).
    this.chassis = new WheelSystem(
      def,
      this.vb,
      this.frame,
      ground,
      { spec: this.engineSpec, state: this.engine, pipeline: this.powerplant },
      { spec: this.gearboxSpec, state: this.gearbox },
    )
    this.#design = this.vb.body.pos.slice()
    this.#bay = engineBayBeams(def, this.vb)
    this.prevPos = new Float64Array(this.vb.body.pos.length)
    this.#setPose(at)
    this.vb.body.pos.set(this.vb.body.pos0)
    this.prevPos.set(this.vb.body.pos)
    this.automatic = def.drivetrain.automatic
    this.gearbox.gear = this.automatic ? 1 : 0
    this.params.subscribe((id, v) => this.#applyParam(id, v))
    for (const d of def.params) this.#applyParam(d.id, d.default)
    computeFrame(this.vb.body, this.vb.refs, this.frame)
  }

  get body(): VehicleBody['body'] {
    return this.vb.body
  }

  get wheels(): readonly WheelState[] {
    return this.chassis.wheels
  }

  #applyParam(id: string, v: number): void {
    const ch = this.chassis
    const s = ch.setup
    const eachWheel = (axle: 'front' | 'rear', fn: (i: number) => void): void =>
      this.def.wheels.forEach((w, i) => {
        if (w.axle === axle) fn(i)
      })
    const axle = id.includes('.front.') ? 'front' : 'rear'
    switch (id) {
      case 'susp.front.spring':
      case 'susp.rear.spring':
        eachWheel(axle, (i) => ch.setSpring(i, v))
        break
      case 'susp.front.bump':
      case 'susp.rear.bump':
        eachWheel(axle, (i) => (s.struts[i]!.damperBump = v))
        break
      case 'susp.front.rebound':
      case 'susp.rear.rebound':
        eachWheel(axle, (i) => (s.struts[i]!.damperRebound = v))
        break
      case 'susp.front.arb':
        s.antiRoll.front = v
        break
      case 'susp.rear.arb':
        s.antiRoll.rear = v
        break
      case 'align.front.camber':
      case 'align.rear.camber':
        eachWheel(axle, (i) => (s.camberLean[i] = Math.sign(this.def.wheels[i]!.x) * v * DEG))
        break
      case 'align.front.toe':
      case 'align.rear.toe':
        eachWheel(axle, (i) => (s.toe[i] = v * DEG))
        break
      case 'steer.lock':
        s.maxSteer = v * DEG
        break
      case 'steer.ackermann':
        s.ackermann = v
        break
      case 'tyre.front.pressure':
      case 'tyre.rear.pressure':
        eachWheel(axle, (i) => (s.pressure[i] = v))
        break
      case 'tyre.grip':
        s.grip = v
        break
      case 'brake.force':
        s.brakeForce = v
        break
      case 'brake.bias':
        s.brakeBias = v
        break
      case 'drive.split':
        s.frontSplit = v
        ch.applySetup()
        break
      case 'diff.lock':
        s.diffLock = v
        ch.applySetup()
        break
      case 'gear.auto':
        this.automatic = v >= 0.5
        break
      case 'gear.final':
        this.gearboxSpec.finalDrive = v
        break
      case 'gear.shiftTime':
        this.gearboxSpec.shiftTime = v
        break
      case 'engine.limiter':
        this.engineSpec.limiterRpm = v
        break
      case 'engine.torqueScale': {
        const c = this.def.engine.torqueCurve
        this.engineSpec.torqueCurve = curve([...c.xs].map((x, i) => [x, (c.ys[i] ?? 0) * v] as const))
        break
      }
      case 'body.stiffness': {
        const sp = this.vb.body.spring
        for (let i = 0; i < this.#shellSpring0.length; i++) sp[i] = this.#shellSpring0[i]! * v
        break
      }
      default:
        // `<moduleId>.<key>` → engine pipeline module (turbo.boost, fuel.lambda, …).
        if (!this.powerplant.setParam(id, v)) throw new Error(`Param "${id}" is not handled by ${this.def.id}`)
    }
  }

  /** Raw gear change used by the automatic gearbox. */
  #autoGear(delta: 1 | -1): void {
    shift(this.gearboxSpec, this.gearbox, delta)
    this.#autoCooldown = AUTO_SHIFT_COOLDOWN
  }

  /**
   * Driver's gear lever (sequential). Automatic: ignored. Manual: a gear can
   * only be engaged with the clutch disengaged (else it grinds and stays in
   * the current gear); neutral is always reachable; reverse needs ~standstill.
   * Returns whether the gear changed.
   */
  shift(delta: 1 | -1): boolean {
    if (this.automatic) return false
    const gb = this.gearbox
    const target = gb.gear + delta
    if (target < -1 || target > this.gearboxSpec.ratios.length) return false
    if (target !== 0) {
      const v = this.forwardSpeed()
      const clutchFree = this.chassis.input.clutch < 0.3
      const wrongWay = (target === -1 && v > 1) || (target > 0 && v < -1)
      if (!clutchFree || wrongWay) {
        this.#grind = GRIND_TIME
        return false
      }
    }
    gb.gear = target
    gb.shiftTimer = target === 0 ? 0 : LEVER_TIME
    return true
  }

  /** Signed speed along the body's forward axis, m/s. */
  forwardSpeed(): number {
    const f = this.frame
    return f.vx * f.fx + f.vy * f.fy + f.vz * f.fz
  }

  /** Engine rpm implied by the driven wheels in the current gear. */
  wheelRpm(): number {
    return Math.abs(this.chassis.carrierOmega() * gearRatio(this.gearboxSpec, this.gearbox.gear)) * RADS_TO_RPM
  }

  /** Called once per fixed step BEFORE the physics world steps. */
  preStep(dt: number, c: DriverControls): void {
    this.prevPos.set(this.vb.body.pos)
    const gb = this.gearbox
    if (gb.shiftTimer > 0) gb.shiftTimer = Math.max(0, gb.shiftTimer - dt)
    if (this.#autoCooldown > 0) this.#autoCooldown -= dt
    if (this.#grind > 0) this.#grind -= dt

    let throttle = c.throttle
    let brake = c.brake
    if (this.automatic) {
      const v = this.forwardSpeed()
      // Reverse: hold brake at a standstill; throttle selects drive again.
      if (gb.gear >= 0 && v < 0.5 && brake > 0.5 && throttle < 0.1) {
        this.#reverseHold += dt
        if (this.#reverseHold > REVERSE_HOLD && gb.gear !== -1) {
          gb.gear = -1
          gb.shiftTimer = this.gearboxSpec.shiftTime
        }
      } else this.#reverseHold = 0
      if (gb.gear === -1) {
        if (throttle > 0.5 && v > -0.5) {
          gb.gear = 1
          gb.shiftTimer = this.gearboxSpec.shiftTime
        } else {
          // In reverse the pedals swap: "brake" key drives backwards.
          const t = throttle
          throttle = brake
          brake = t
        }
      }
      if (gb.gear === 0 && throttle > 0.1) gb.gear = 1
      this.#autoShift(throttle)
    }

    const ch = this.chassis
    const pedal = clutchEngagement(clamp(c.clutch, 0, 1))
    if (this.automatic) {
      // Automatic: a slipping coupling (torque-converter-like) that takes up
      // drive as revs rise above idle and lets go near idle — it cannot stall
      // the engine; the clutch pedal still overrides.
      const idle = this.engineSpec.idleRpm
      const lo = idle * 1.02 + 500 * throttle
      const launch = this.engine.running ? smoothstep(lo, lo + 900, engineRpm(this.engine)) : 0
      const locked = this.engine.running && this.wheelRpm() > idle * 1.25 ? 1 : 0
      // With the handbrake pulled the converter slips instead of dragging the
      // rear axle round with the engine (lets the rears lock for a slide).
      const hb = 1 - smoothstep(0.1, 0.5, c.handbrake)
      ch.input.clutch = Math.max(launch, locked) * pedal * hb
    } else {
      // Manual: the pedal is the only thing between engine and wheels.
      ch.input.clutch = pedal
    }
    ch.input.cutThrottle = this.automatic
    ch.input.starter = c.starter
    ch.input.throttle = throttle
    ch.input.brake = brake
    ch.input.handbrake = c.handbrake

    // Steering: input +1 = right; angles + = left.
    const s = ch.setup
    const delta = -c.steer * s.maxSteer
    const wb = ch.wheelbase
    this.def.wheels.forEach((w, i) => {
      ch.wheels[i]!.steer = wheelSteerAngle(w.steer ? delta : 0, wb, w.x, s.ackermann, s.toe[i]!)
    })
  }

  #autoShift(throttle: number): void {
    const gb = this.gearbox
    if (gb.gear < 1 || gb.shiftTimer > 0 || this.#autoCooldown > 0) return
    const rpm = this.wheelRpm()
    const red = this.engineSpec.redlineRpm
    const up = 3000 + (red * 0.97 - 3000) * throttle
    const down = 1400 + 1800 * throttle
    if (rpm > up && gb.gear < this.gearboxSpec.ratios.length) this.#autoGear(1)
    else if (rpm < down && gb.gear > 1) {
      // Only downshift if the lower gear will not over-rev.
      const next = (rpm * gearRatio(this.gearboxSpec, gb.gear - 1)) / gearRatio(this.gearboxSpec, gb.gear)
      if (next < red * 0.9) this.#autoGear(-1)
    }
  }

  /** Called once per fixed step AFTER the physics world steps. */
  postStep(): void {
    computeFrame(this.vb.body, this.vb.refs, this.frame)
    // Engine health from engine-bay crush (cheap, a few times per second).
    if ((this.#healthTimer = (this.#healthTimer + 1) % 12) === 0) this.engine.health = engineHealthFrom(this.vb.body, this.#bay)
  }

  /** Design pose → world pose (rotation about +y by yaw, then translation) into pos0. */
  #setPose(p: VehiclePose): void {
    const d = this.#design
    const out = this.vb.body.pos0
    const c = Math.cos(p.yaw)
    const s = Math.sin(p.yaw)
    for (let i = 0; i < d.length; i += 3) {
      const x = d[i]!
      const z = d[i + 2]!
      out[i] = p.x + x * c + z * s
      out[i + 1] = p.y + d[i + 1]!
      out[i + 2] = p.z - x * s + z * c
    }
  }

  /** Teleport: new spawn pose (becomes the reset point) and a full repair. */
  placeAt(p: VehiclePose): void {
    this.#setPose(p)
    this.reset()
  }

  reset(): void {
    resetBody(this.vb.body)
    this.prevPos.set(this.vb.body.pos)
    Object.assign(this.engine, newEngineState(this.engineSpec))
    Object.assign(this.gearbox, newGearboxState())
    this.gearbox.gear = this.automatic ? 1 : 0
    this.#grind = 0
    this.chassis.reset()
    this.powerplant.reset()
    this.engine.health = 1
    // Re-apply body stiffness (resetBody does not touch spring rates).
    this.#applyParam('body.stiffness', this.params.get('body.stiffness'))
    computeFrame(this.vb.body, this.vb.refs, this.frame)
  }

  telemetry(out: VehicleTelemetry): VehicleTelemetry {
    out.speedKmh = Math.abs(this.forwardSpeed()) * 3.6
    out.rpm = engineRpm(this.engine)
    out.gear = gearLabel(this.gearbox.gear)
    out.throttle = this.engine.throttle
    out.load = this.engine.load
    out.damage = damage(this.vb.body)
    out.limiter = this.engine.limiterCut
    out.running = this.engine.running
    out.clutch = this.chassis.input.clutch
    out.automatic = this.automatic
    out.grind = this.#grind > 0
    const c = this.powerplant.c
    out.turbo = this.powerplant.module('turbo')?.enabled ?? false
    out.boost = c.boost
    out.turboSpin = c.turboSpin
    out.lambda = c.lambda
    out.egt = c.egt
    out.smoke = c.smoke
    out.soot = c.soot
    out.afterfires = c.afterfires
    out.afterfireStrength = c.lastAfterfire
    out.blowOffs = c.blowOffs
    out.engineHealth = this.engine.health
    let off = 0
    for (const w of this.chassis.wheels) if (w.detached) off++
    out.wheelsOff = off
    return out
  }

  /** Convert a body-local design point (e.g. driver eye) to frame-relative coordinates. */
  frameLocal(p: readonly [number, number, number]): [number, number, number] {
    return [p[0] - this.comLocal[0], p[1] - this.comLocal[1], p[2] - this.comLocal[2]]
  }

  /** Torque at a given rpm (for HUD / tuning graphs). */
  torqueAt(rpm: number): number {
    return sample(this.engineSpec.torqueCurve, rpm)
  }
}

export const newTelemetry = (): VehicleTelemetry => ({
  speedKmh: 0,
  rpm: 0,
  gear: 'N',
  throttle: 0,
  load: 0,
  damage: 0,
  limiter: false,
  running: true,
  clutch: 1,
  automatic: true,
  grind: false,
  turbo: false,
  boost: 0,
  turboSpin: 0,
  lambda: 0.88,
  egt: 300,
  smoke: 0,
  soot: 0,
  afterfires: 0,
  afterfireStrength: 0,
  blowOffs: 0,
  engineHealth: 1,
  wheelsOff: 0,
})

/** Shell beams whose both ends sit ahead of the front axle (engine bay / crumple zone). */
function engineBayBeams(def: VehicleDef, vb: VehicleBody): Uint32Array {
  const zFront = Math.max(...def.wheels.filter((w) => w.axle === 'front').map((w) => w.z)) - 0.3
  const b = vb.body
  const out: number[] = []
  for (let i = 0; i < vb.shellBeams; i++) {
    if (b.pos[b.beamA[i]! * 3 + 2]! > zFront && b.pos[b.beamB[i]! * 3 + 2]! > zFront) out.push(i)
  }
  return Uint32Array.from(out)
}

/**
 * Engine health from the plastic crush of the engine bay: ~1–2 % average
 * permanent strain = scratched bumper (healthy); ~7 % and broken beams =
 * radiator/block destroyed (dead).
 */
export function engineHealthFrom(b: VehicleBody['body'], bay: Uint32Array): number {
  if (bay.length === 0) return 1
  let crush = 0
  for (let k = 0; k < bay.length; k++) {
    const i = bay[k]!
    crush += b.flags[i]! & BeamFlag.Broken ? 0.25 : Math.abs(b.rest[i]! - b.rest0[i]!) / b.rest0[i]!
  }
  crush /= bay.length
  return 1 - smoothstep(0.012, 0.07, crush)
}
