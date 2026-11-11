/**
 * Combustion engine model: torque map × throttle, friction/pumping losses,
 * rotational inertia, idle controller, rev limiter (fuel cut).
 * Pure + stateful-by-struct for easy testing and worker transfer.
 */
import { clamp, RADS_TO_RPM, RPM_TO_RADS } from '../../core/math/scalar.ts'
import { sample, type Curve } from './curve.ts'

export interface EngineSpec {
  torqueCurve: Curve // rpm -> Nm at full throttle
  idleRpm: number
  redlineRpm: number
  limiterRpm: number
  inertia: number // kg·m²
  frictionTorque: number // Nm constant
  frictionCoef: number // Nm per rad/s
  /** Engine braking (closed-throttle pumping) at redline, Nm. */
  brakingTorque: number
  cylinders: number
}

export interface EngineState {
  omega: number // rad/s
  throttle: number // 0..1 after idle control
  limiterCut: boolean
  torque: number // last net output torque, Nm
  load: number // 0..1 for audio
}

export const newEngineState = (spec: EngineSpec): EngineState => ({
  omega: spec.idleRpm * RPM_TO_RADS,
  throttle: 0,
  limiterCut: false,
  torque: 0,
  load: 0,
})

export const engineRpm = (s: EngineState): number => s.omega * RADS_TO_RPM

/** Combustion torque minus losses, at given rpm & effective throttle. */
export function engineTorque(spec: EngineSpec, rpm: number, throttle: number): number {
  const omega = rpm * RPM_TO_RADS
  const full = sample(spec.torqueCurve, rpm)
  const losses = spec.frictionTorque + spec.frictionCoef * omega
  const pumping = spec.brakingTorque * clamp(rpm / spec.redlineRpm, 0, 1.2) * (1 - throttle)
  return full * throttle - losses - pumping
}

/**
 * Advance engine. `loadTorque` = torque the drivetrain draws through the
 * clutch (positive resists rotation). Returns net torque applied to flywheel.
 */
export function stepEngine(spec: EngineSpec, s: EngineState, pedal: number, loadTorque: number, dt: number): void {
  const rpm = engineRpm(s)
  // Idle controller: blend in throttle as rpm falls toward idle.
  const idleThrottle = clamp((spec.idleRpm * 1.05 - rpm) / (spec.idleRpm * 0.3), 0, 0.35)
  let thr = Math.max(clamp(pedal, 0, 1), idleThrottle)
  // Rev limiter with hysteresis.
  if (rpm >= spec.limiterRpm) s.limiterCut = true
  else if (rpm < spec.limiterRpm - 150) s.limiterCut = false
  if (s.limiterCut) thr = 0
  s.throttle = thr
  const t = engineTorque(spec, rpm, thr)
  s.torque = t
  const full = sample(spec.torqueCurve, rpm)
  s.load = full > 0 ? clamp((t + spec.frictionTorque) / full, 0, 1) : 0
  s.omega += ((t - loadTorque) / spec.inertia) * dt
  if (s.omega < 0) s.omega = 0
}

export const powerKw = (spec: EngineSpec, rpm: number): number =>
  (sample(spec.torqueCurve, rpm) * rpm * RPM_TO_RADS) / 1000
