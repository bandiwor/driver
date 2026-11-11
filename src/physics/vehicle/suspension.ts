/**
 * Strut (coil-over) force model: preloaded spring, separate bump/rebound
 * damping, progressive bump stop at full compression and a droop limiter at
 * full extension. Pure; the vehicle applies the result along the strut axis.
 */
export interface StrutSpec {
  spring: number // N/m
  damperBump: number // N·s/m (compressing)
  damperRebound: number // N·s/m (extending)
  /** Strut length at design ride height, m. */
  designLength: number
  /** Free (unloaded) spring length; > designLength gives static preload. */
  restLength: number
  compressionTravel: number // m from design length
  droopTravel: number // m from design length
  bumpStopRate: number // N/m
}

/**
 * @param length current strut length
 * @param vRel   rate of change of length (+ = extending)
 * @returns force pushing the two ends apart (N, negative pulls together)
 */
export function strutForce(s: StrutSpec, length: number, vRel: number): number {
  let f = s.spring * (s.restLength - length)
  f -= (vRel < 0 ? s.damperBump : s.damperRebound) * vRel
  const minL = s.designLength - s.compressionTravel
  if (length < minL) {
    const d = minL - length
    f += s.bumpStopRate * d * (1 + d / 0.02) // progressive rubber stop
  }
  const maxL = s.designLength + s.droopTravel
  if (length > maxL) f -= s.bumpStopRate * (length - maxL)
  return f
}

/** Spring free length that holds `staticLoad` at the design length. */
export const preloadedRestLength = (designLength: number, staticLoad: number, spring: number): number =>
  designLength + staticLoad / spring

/** Anti-roll bar: force on the left strut (+ resists left compression); right gets the opposite. */
export const antiRollForce = (rate: number, compressionLeft: number, compressionRight: number): number =>
  rate * (compressionLeft - compressionRight)
