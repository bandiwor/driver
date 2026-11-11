/**
 * Runtime vehicle instance: physical body + powertrain state + tunable params.
 * Pure simulation (no three.js / DOM) so it runs in tests, snapshot mode and,
 * later, inside the physics worker.
 */
import { ParamStore } from '../core/params.ts'
import { computeFrame, newFrame, type BodyFrame } from '../physics/softbody/frame.ts'
import { centerOfMass, damage, resetBody, translateBody } from '../physics/softbody/softbody.ts'
import { engineRpm, newEngineState, stepEngine, type EngineSpec, type EngineState } from '../physics/vehicle/engine.ts'
import { gearLabel, newGearboxState, shift, type GearboxSpec, type GearboxState } from '../physics/vehicle/gearbox.ts'
import { curve, sample } from '../physics/vehicle/curve.ts'
import type { DriverControls } from '../input/input.ts'
import { buildVehicleBody, type VehicleBody } from './build.ts'
import type { VehicleDef } from './types.ts'

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
  /** Centre of mass in body-local coordinates (frame origin offset). */
  readonly comLocal: readonly [number, number, number]

  constructor(def: VehicleDef, spawn: readonly [number, number, number] = [0, 0, 0]) {
    this.def = def
    this.params = new ParamStore(def.params)
    this.vb = buildVehicleBody(def)
    const c = centerOfMass(this.vb.body)
    this.comLocal = [c[0]!, c[1]!, c[2]!]
    translateBody(this.vb.body, spawn[0], spawn[1], spawn[2])
    this.vb.body.pos0.set(this.vb.body.pos)
    this.prevPos = this.vb.body.pos.slice()
    this.engineSpec = { ...def.engine }
    this.gearboxSpec = { ...def.gearbox }
    this.engine = newEngineState(this.engineSpec)
    this.params.subscribe((id, v) => this.#applyParam(id, v))
    computeFrame(this.vb.body, this.vb.refs, this.frame)
  }

  get body(): VehicleBody['body'] {
    return this.vb.body
  }

  #applyParam(id: string, v: number): void {
    switch (id) {
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
      // Suspension / tyre / brake / body params are consumed by the wheel
      // model (plan step 2) and body rebuild (step 3).
    }
  }

  shift(delta: 1 | -1): void {
    shift(this.gearboxSpec, this.gearbox, delta)
  }

  /** Called once per fixed step BEFORE the physics world steps. */
  preStep(dt: number, c: DriverControls): void {
    this.prevPos.set(this.vb.body.pos)
    if (this.gearbox.shiftTimer > 0) this.gearbox.shiftTimer = Math.max(0, this.gearbox.shiftTimer - dt)
    // Skeleton: drivetrain is decoupled (no wheel model yet) -> engine revs freely.
    const sub = 8
    for (let i = 0; i < sub; i++) stepEngine(this.engineSpec, this.engine, c.throttle, 0, dt / sub)
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
    computeFrame(this.vb.body, this.vb.refs, this.frame)
  }

  telemetry(out: VehicleTelemetry): VehicleTelemetry {
    const f = this.frame
    out.speedKmh = Math.hypot(f.vx, f.vz) * 3.6
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

  /** Torque at current rpm (for HUD / tuning graphs). */
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
