export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a))
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp(invLerp(a, b, v), 0, 1)
  return t * t * (3 - 2 * t)
}
/** Frame-rate independent exponential smoothing toward target. */
export const damp = (cur: number, target: number, lambda: number, dt: number): number =>
  lerp(cur, target, 1 - Math.exp(-lambda * dt))
export const approach = (cur: number, target: number, maxDelta: number): number =>
  cur < target ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target)
export const RPM_TO_RADS = (2 * Math.PI) / 60
export const RADS_TO_RPM = 60 / (2 * Math.PI)
export const MS_TO_KMH = 3.6
