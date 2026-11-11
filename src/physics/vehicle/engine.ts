/**
 * Combustion engine model: torque map × throttle, friction/pumping losses,
 * rotational inertia, idle controller, rev limiter (fuel cut), and a
 * running/stalled state machine with an electric starter.
 *
 *   RUNNING ──(rpm < stallRpm, after catch-up)──► STALLED
 *   STALLED ──(cranked above crankRpm for crankTime)──► RUNNING (catch-up)
 *   STALLED ──(rpm > pushStartRpm, e.g. rolling in gear)──► RUNNING
 *
 * Nothing forces a stall: below stallRpm combustion simply cannot be
 * sustained, and whether rpm gets there is decided by the driveline physics
 * (clutch dumped at idle, too high a gear, stopping in gear…).
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
  /** Below this rpm combustion cannot sustain itself → stall. */
  stallRpm: number
  /** Cranking speed at which the engine catches while the starter turns it. */
  crankRpm: number
  /** Rolling (clutch engaged) above this rpm restarts a stalled engine. */
  pushStartRpm: number
  /** Starter torque at 0 rpm, Nm (falls linearly to 0 at starterMaxRpm). */
  starterTorque: number
  starterMaxRpm: number
  /** Seconds of cranking above crankRpm before the engine catches. */
  crankTime: number
  /** Max throttle the idle controller may add, 0..1. */
  idleControlMax: number
}

export interface EngineState {
  omega: number // rad/s
  throttle: number // 0..1 after idle control
  limiterCut: boolean
  torque: number // last net output torque, Nm
  load: number // 0..1 for audio
  running: boolean
  /** Just caught: stall check suspended until rpm rises above stallRpm. */
  catching: boolean
  /** Accumulated cranking time above crankRpm, s. */
  crankTimer: number
}

export const newEngineState = (spec: EngineSpec): EngineState => ({
  omega: spec.idleRpm * RPM_TO_RADS,
  throttle: 0,
  limiterCut: false,
  torque: 0,
  load: 0,
  running: true,
  catching: false,
  crankTimer: 0,
})

export const engineRpm = (s: EngineState): number => s.omega * RADS_TO_RPM

/** Friction + pumping losses (always present, also when stalled). */
export function engineLosses(spec: EngineSpec, rpm: number, throttle: number): number {
  if (rpm <= 0) return 0
  const omega = rpm * RPM_TO_RADS
  const pumping = spec.brakingTorque * clamp(rpm / spec.redlineRpm, 0, 1.2) * (1 - throttle)
  // Static friction fades in from standstill so a stopped engine is not pushed backwards.
  const fade = clamp(rpm / 50, 0, 1)
  return (spec.frictionTorque + spec.frictionCoef * omega + pumping) * fade
}

/** Combustion torque minus losses, at given rpm & effective throttle (engine running). */
export function engineTorque(spec: EngineSpec, rpm: number, throttle: number): number {
  return sample(spec.torqueCurve, rpm) * throttle - engineLosses(spec, rpm, throttle)
}

/** Starter motor torque at the crankshaft. */
export const starterTorque = (spec: EngineSpec, rpm: number): number =>
  spec.starterTorque * clamp(1 - rpm / spec.starterMaxRpm, 0, 1)

/**
 * State transitions + torque for this instant. Updates throttle/limiter/
 * load/torque/running on the state and returns the net torque on the
 * flywheel (Nm). Does NOT integrate — the driveline solver integrates the
 * flywheel together with the clutch (implicitly).
 */
export function engineDrive(spec: EngineSpec, s: EngineState, pedal: number, starter = 0, dt = 0): number {
  const rpm = engineRpm(s)
  // ── running / stalled state machine ──
  if (s.running) {
    if (s.catching && rpm > spec.stallRpm * 1.15) s.catching = false
    const floor = s.catching ? spec.crankRpm * 0.6 : spec.stallRpm
    if (rpm < floor) {
      s.running = false
      s.catching = false
    }
  } else {
    if (starter > 0.5 && rpm > spec.crankRpm) s.crankTimer += dt
    else if (starter <= 0.5) s.crankTimer = 0
    if (s.crankTimer >= spec.crankTime || rpm > spec.pushStartRpm) {
      s.running = true
      s.catching = true
      s.crankTimer = 0
    }
  }
  const cranking = starter > 0.5 && !(s.running && !s.catching) ? starterTorque(spec, rpm) : 0

  if (!s.running) {
    s.throttle = 0
    s.limiterCut = false
    s.load = 0
    s.torque = cranking - engineLosses(spec, rpm, 0)
    return s.torque
  }

  // Idle controller: blend in throttle as rpm falls toward idle (limited authority).
  const idleThrottle = clamp((spec.idleRpm * 1.05 - rpm) / (spec.idleRpm * 0.3), 0, spec.idleControlMax)
  let thr = Math.max(clamp(pedal, 0, 1), idleThrottle)
  if (rpm >= spec.limiterRpm) s.limiterCut = true
  else if (rpm < spec.limiterRpm - 150) s.limiterCut = false
  if (s.limiterCut) thr = 0
  s.throttle = thr
  const t = engineTorque(spec, rpm, thr) + cranking
  s.torque = t
  const full = sample(spec.torqueCurve, rpm)
  s.load = full > 0 ? clamp((t + spec.frictionTorque) / full, 0, 1) : 0
  return t
}

/**
 * Free-revving engine step (clutch open). `loadTorque` = torque drawn by the
 * drivetrain (positive resists rotation).
 */
export function stepEngine(
  spec: EngineSpec,
  s: EngineState,
  pedal: number,
  loadTorque: number,
  dt: number,
  starter = 0,
): void {
  const t = engineDrive(spec, s, pedal, starter, dt)
  s.omega += ((t - loadTorque) / spec.inertia) * dt
  if (s.omega < 0) s.omega = 0
}

export const powerKw = (spec: EngineSpec, rpm: number): number =>
  (sample(spec.torqueCurve, rpm) * rpm * RPM_TO_RADS) / 1000
