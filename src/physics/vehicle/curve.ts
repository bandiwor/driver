/** Monotone piecewise-linear curve lookup (x ascending). Used for torque maps etc. */
export interface Curve {
  readonly xs: Float64Array
  readonly ys: Float64Array
}
export const curve = (points: readonly (readonly [number, number])[]): Curve => {
  if (points.length < 2) throw new Error('Curve needs >= 2 points')
  for (let i = 1; i < points.length; i++) {
    if (points[i]![0] <= points[i - 1]![0]) throw new Error('Curve x must ascend')
  }
  return { xs: Float64Array.from(points, (p) => p[0]), ys: Float64Array.from(points, (p) => p[1]) }
}
export const sample = (c: Curve, x: number): number => {
  const { xs, ys } = c
  const n = xs.length
  if (x <= xs[0]!) return ys[0]!
  if (x >= xs[n - 1]!) return ys[n - 1]!
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid]! <= x) lo = mid
    else hi = mid
  }
  const t = (x - xs[lo]!) / (xs[hi]! - xs[lo]!)
  return ys[lo]! + (ys[hi]! - ys[lo]!) * t
}
