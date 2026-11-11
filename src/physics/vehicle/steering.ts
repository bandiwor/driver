/**
 * Steering geometry. Angles in rad; + steers left (toward body +x).
 * Ackermann: the inner wheel turns tighter so both follow circles around a
 * common centre on the rear-axle line. Toe: static per-side offset
 * (+ = toe-in, i.e. both fronts point slightly toward the centreline).
 */
export function ackermannAngle(delta: number, wheelbase: number, lateral: number): number {
  if (Math.abs(delta) < 1e-6) return delta
  // Turn radius at the axle centre, then the angle for a wheel offset by `lateral` (+x = left).
  const r = wheelbase / Math.tan(delta)
  return Math.atan(wheelbase / (r - lateral))
}

export function wheelSteerAngle(
  delta: number,
  wheelbase: number,
  lateral: number,
  ackermann: number,
  toe: number,
): number {
  const a = delta + (ackermannAngle(delta, wheelbase, lateral) - delta) * ackermann
  // Toe-in: left wheel (lateral > 0) points right (negative), right wheel left.
  return a - Math.sign(lateral) * toe
}
