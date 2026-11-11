/**
 * Tyre force model: Pacejka "Magic Formula" (simplified, same curve for
 * longitudinal and lateral slip) with
 *   - combined slip via friction ellipse,
 *   - load sensitivity (peak μ drops as load rises above nominal),
 *   - camber: thrust toward the lean + small peak-grip loss,
 *   - pressure: radial stiffness, cornering stiffness and grip vs. nominal.
 * Pure functions → trivially unit-tested.
 */
export interface TyreSpec {
  B: number // stiffness factor
  C: number // shape factor
  D: number // peak friction coefficient (μ) at nominal load
  E: number // curvature factor
  /** Lateral uses the same curve with slip angle (rad) × this scale. */
  lateralScale: number
  radius: number
  width: number
  rollingResistance: number
  /** Fractional μ loss per unit of (load/nominal − 1). */
  loadSensitivity: number
  /** Radial stiffness at nominal pressure, N/m. */
  radialStiffness: number
  radialDamping: number
  /** Lateral relaxation length, m. */
  relaxationLength: number
  /** Camber thrust, N per N of load per rad. */
  camberStiffness: number
  /** Nominal inflation pressure, kPa. */
  pressure: number
}

export const magic = (slip: number, B: number, C: number, D: number, E: number): number => {
  const bx = B * slip
  return D * Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))))
}

export interface TyreForces {
  fx: number // longitudinal, N (+ = forward)
  fy: number // lateral, N (+ = toward the wheel's +lateral / left)
}

/** Per-instant tyre conditions (all SI; angles in rad). */
export interface TyreInput {
  slipRatio: number
  slipAngle: number
  load: number
  nominalLoad: number
  surfaceMu: number
  /** Lean of the wheel toward +lateral, rad. */
  camber: number
  /** Inflation pressure, kPa. */
  pressure: number
  /** Surface stiffness factor (loose gravel/sand < 1: softer, flatter slip curve). */
  surfaceStiffness?: number
}

export interface TyreCoefs {
  B: number
  D: number
}

/** Effective stiffness / peak μ for the current load, pressure and camber. */
export function tyreCoefs(t: TyreSpec, i: TyreInput, out: TyreCoefs): TyreCoefs {
  const pr = i.pressure / t.pressure
  const loadRatio = i.nominalLoad > 0 ? i.load / i.nominalLoad : 1
  // Pressure: stiffer carcass (higher B) but smaller patch away from nominal.
  const pressureGrip = 1 - 0.35 * (pr - 1) * (pr - 1)
  const camberGrip = 1 - 2 * i.camber * i.camber
  out.B = t.B * Math.sqrt(pr) * (i.surfaceStiffness ?? 1)
  out.D = Math.max(0.05, t.D * (1 - t.loadSensitivity * (loadRatio - 1)) * pressureGrip * camberGrip) * i.surfaceMu
  return out
}

const coefs: TyreCoefs = { B: 0, D: 0 }

export function tyreForces2(t: TyreSpec, i: TyreInput, out: TyreForces): TyreForces {
  if (i.load <= 0) {
    out.fx = 0
    out.fy = 0
    return out
  }
  const { B, D } = tyreCoefs(t, i, coefs)
  const fx0 = magic(i.slipRatio, B, t.C, D, t.E)
  const fy0 = -magic(i.slipAngle * t.lateralScale, B, t.C, D, t.E) + t.camberStiffness * i.camber
  const mag = Math.hypot(fx0, fy0)
  const k = mag > D ? D / mag : 1
  out.fx = fx0 * k * i.load
  out.fy = fy0 * k * i.load
  return out
}

/** Legacy simple API (no load sensitivity / camber / pressure). */
export function tyreForces(
  t: TyreSpec,
  slipRatio: number,
  slipAngle: number,
  load: number,
  surfaceMu: number,
  out: TyreForces,
): TyreForces {
  return tyreForces2(
    t,
    { slipRatio, slipAngle, load, nominalLoad: load, surfaceMu, camber: 0, pressure: t.pressure },
    out,
  )
}

/** Slip ratio with a low-speed floor `v0` so it stays finite at standstill. */
export const slipRatio = (wheelOmega: number, radius: number, groundSpeed: number, v0 = 1): number =>
  (wheelOmega * radius - groundSpeed) / Math.max(Math.abs(groundSpeed), v0)

/** Slip angle with a low-speed floor: behaves like a damper near standstill. */
export const slipAngle = (vLong: number, vLat: number, v0 = 3): number => Math.atan2(vLat, Math.max(Math.abs(vLong), v0))

/**
 * Upper bound of d(Fx)/d(ω) · R (Nm per rad/s) — the tyre's torque stiffness
 * around zero slip. Used for implicit wheel integration (unconditionally stable).
 */
export const tyreTorqueStiffness = (t: TyreSpec, load: number, peakMu: number, B: number, vLong: number, v0 = 1): number =>
  (B * t.C * peakMu * load * t.radius * t.radius) / Math.max(Math.abs(vLong), v0)
