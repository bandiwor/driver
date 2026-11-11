/** Gearbox + final drive + clutch. Index 0 = reverse, 1 = neutral, 2.. = forward. */
export interface GearboxSpec {
  /** Forward ratios, e.g. [3.6, 2.1, 1.4, 1.0, 0.8]. */
  ratios: readonly number[]
  reverse: number // positive number, sign applied internally
  finalDrive: number
  shiftTime: number // s, torque interrupted
  /** Max torque the clutch can transmit, Nm. */
  clutchMaxTorque: number
}

export interface GearboxState {
  gear: number // -1 R, 0 N, 1..n
  shiftTimer: number
}

export const newGearboxState = (): GearboxState => ({ gear: 0, shiftTimer: 0 })

export const gearRatio = (spec: GearboxSpec, gear: number): number => {
  if (gear === 0) return 0
  if (gear < 0) return -spec.reverse * spec.finalDrive
  const r = spec.ratios[gear - 1]
  if (r === undefined) throw new Error(`No gear ${gear}`)
  return r * spec.finalDrive
}

export const gearLabel = (gear: number): string => (gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear))

export function shift(spec: GearboxSpec, s: GearboxState, delta: 1 | -1): boolean {
  const next = s.gear + delta
  if (next < -1 || next > spec.ratios.length) return false
  s.gear = next
  s.shiftTimer = spec.shiftTime
  return true
}

/**
 * Clutch as a slipping friction coupling: transmitted torque grows with slip,
 * capped by clutch capacity × engagement. Returns torque from engine to box.
 */
export function clutchTorque(spec: GearboxSpec, engagement: number, engineOmega: number, boxOmega: number): number {
  const slip = engineOmega - boxOmega
  const cap = spec.clutchMaxTorque * engagement
  // Stiff viscous term near zero slip, saturating at capacity (smooth Coulomb).
  return cap * Math.tanh(slip / 8)
}

/** Simple automatic: upshift near redline, downshift when lugging. */
export function autoShift(spec: GearboxSpec, s: GearboxState, rpm: number, upRpm: number, downRpm: number): void {
  if (s.shiftTimer > 0 || s.gear <= 0) return
  if (rpm > upRpm && s.gear < spec.ratios.length) shift(spec, s, 1)
  else if (rpm < downRpm && s.gear > 1) shift(spec, s, -1)
}
