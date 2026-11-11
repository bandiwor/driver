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
import { centerOfMass, damage, resetBody, translateBody } from '../physics/softbody/softbody.ts'
import { FlatGround, type Ground } from '../physics/softbody/ground.ts'
import { engineRpm, newEngineState, type EngineSpec, type EngineState } from '../physics/vehicle/engine.ts'
import { gearLabel, gearRatio, newGearboxState, shift, type GearboxSpec, type GearboxState } from '../physics/vehicle/gearbox.ts'
import { curve, sample } from '../physics/vehicle/curve.ts'
import { wheelSteerAngle } from '../physics/vehicle/steering.ts'
import type { DriverControls } from '../input/input.ts'
import { buildVehicleBody, type VehicleBody } from './build.ts'
import { WheelSystem, type WheelState } from './wheels.ts'
import type { VehicleDef } from './types.ts'

const DEG = Math.PI / 180
/** Minimum time between automatic shifts, s. */
const AUTO_SHIFT_COOLDOWN = 0.7
/** Hold brake at standstill this long to select reverse (automatic), s. */
const REVERSE_HOLD = 0.25

export interface VehicleTelemetry {
  speedKmh: number
  rpm: number
  gear: string
  throttle: number
  load: number
  damage: number
  limiter: boolean
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
  /** Centre of mass in body-local coordinates (frame origin offset). */
  readonly comLocal: readonly [number, number, number]
  automatic: boolean

  readonly #shellSpring0: Float64Array
  #autoCooldown = 0
  #reverseHold = 0

  constructor(def: VehicleDef, spawn: readonly [number, number, number] = [0, 0, 0], ground: Ground = new FlatGround(0)) {
    this.def = def
    this.params = new ParamStore(def.params)
    this.vb = buildVehicleBody(def)
    const c = centerOfMass(this.vb.body)
    this.comLocal = [c[0]!, c[1]!, c[2]!]
    this.#shellSpring0 = this.vb.body.spring.slice(0, this.vb.shellBeams)
    this.engineSpec = { ...def.engine }
    this.gearboxSpec = { ...def.gearbox }
    this.engine = newEngineState(this.engineSpec)
    // Wheel system is built at the design pose (static loads, strut lengths).
    this.chassis = new WheelSystem(
      def,
      this.vb,
      this.frame,
      ground,
      { spec: this.engineSpec, state: this.engine },
      { spec: this.gearboxSpec, state: this.gearbox },
    )
    translateBody(this.vb.body, spawn[0], spawn[1], spawn[2])
    this.vb.body.pos0.set(this.vb.body.pos)
    this.prevPos = this.vb.body.pos.slice()
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
    }
  }

  shift(delta: 1 | -1): void {
    shift(this.gearboxSpec, this.gearbox, delta)
    this.#autoCooldown = AUTO_SHIFT_COOLDOWN
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

    // Auto clutch: engages as revs rise above idle (launch), opens near idle
    // so the engine never stalls; driver pedal overrides.
    const idle = this.engineSpec.idleRpm
    const lo = idle * 1.02 + 500 * throttle
    const launch = smoothstep(lo, lo + 900, engineRpm(this.engine))
    const locked = this.wheelRpm() > idle * 1.25 ? 1 : 0
    const ch = this.chassis
    ch.input.clutch = Math.max(launch, locked) * (1 - clamp(c.clutch, 0, 1))
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
    if (rpm > up && gb.gear < this.gearboxSpec.ratios.length) this.shift(1)
    else if (rpm < down && gb.gear > 1) {
      // Only downshift if the lower gear will not over-rev.
      const next = (rpm * gearRatio(this.gearboxSpec, gb.gear - 1)) / gearRatio(this.gearboxSpec, gb.gear)
      if (next < red * 0.9) this.shift(-1)
    }
  }

  /** Called once per fixed step AFTER the physics world steps. */
  postStep(): void {
    computeFrame(this.vb.body, this.vb.refs, this.frame)
  }

  reset(): void {
    resetBody(this.vb.body)
    this.prevPos.set(this.vb.body.pos)
    Object.assign(this.engine, newEngineState(this.engineSpec))
    Object.assign(this.gearbox, newGearboxState())
    this.gearbox.gear = this.automatic ? 1 : 0
    this.chassis.reset()
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
})
