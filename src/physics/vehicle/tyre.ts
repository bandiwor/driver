/**
 * Tyre force model: Pacejka "Magic Formula" (simplified) with combined-slip
 * friction ellipse. Inputs in SI. Pure functions -> trivially unit-tested.
 */
export interface TyreSpec {
  B: number // stiffness factor
  C: number // shape factor
  D: number // peak friction coefficient (mu)
  E: number // curvature factor
  /** Lateral uses the same curve with slip angle in radians mapped via this scale. */
  lateralScale: number
  radius: number
  width: number
  rollingResistance: number
}

export const magic = (slip: number, B: number, C: number, D: number, E: number): number => {
  const bx = B * slip
  return D * Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))))
}

export interface TyreForces {
  fx: number // longitudinal, N
  fy: number // lateral, N
}

/**
 * @param slipRatio  (wheelSpeed - groundSpeed) / max(|groundSpeed|, eps)
 * @param slipAngle  radians
 * @param load       normal force, N
 * @param surfaceMu  surface friction multiplier
 */
export function tyreForces(
  t: TyreSpec,
  slipRatio: number,
  slipAngle: number,
  load: number,
  surfaceMu: number,
  out: TyreForces,
): TyreForces {
  if (load <= 0) {
    out.fx = 0
    out.fy = 0
    return out
  }
  const fx0 = magic(slipRatio, t.B, t.C, t.D, t.E)
  const fy0 = -magic(slipAngle * t.lateralScale, t.B, t.C, t.D, t.E)
  // Friction ellipse: scale combined vector to stay within mu·load.
  const mag = Math.hypot(fx0, fy0)
  const lim = t.D
  const k = mag > lim ? lim / mag : 1
  const f = load * surfaceMu * k
  out.fx = fx0 * f
  out.fy = fy0 * f
  return out
}

export const slipRatio = (wheelOmega: number, radius: number, groundSpeed: number): number => {
  const ws = wheelOmega * radius
  const denom = Math.max(Math.abs(groundSpeed), 0.5)
  return (ws - groundSpeed) / denom
}
