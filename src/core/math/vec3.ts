/**
 * Allocation-free vec3 helpers operating on flat Float32Array/Float64Array
 * "SoA-in-AoS" buffers (x,y,z interleaved, index = node * 3).
 * Hot loops in physics inline these manually; these are for clarity elsewhere.
 */
export type Buf = Float32Array | Float64Array
export interface Vec3 {
  x: number
  y: number
  z: number
}
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })

export const read = (b: Buf, i: number, out: Vec3): Vec3 => {
  const o = i * 3
  out.x = b[o] ?? 0
  out.y = b[o + 1] ?? 0
  out.z = b[o + 2] ?? 0
  return out
}
export const write = (b: Buf, i: number, x: number, y: number, z: number): void => {
  const o = i * 3
  b[o] = x
  b[o + 1] = y
  b[o + 2] = z
}
export const dist = (b: Buf, i: number, j: number): number => {
  const a = i * 3
  const c = j * 3
  const dx = (b[c] ?? 0) - (b[a] ?? 0)
  const dy = (b[c + 1] ?? 0) - (b[a + 1] ?? 0)
  const dz = (b[c + 2] ?? 0) - (b[a + 2] ?? 0)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
export const length = (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross = (a: Vec3, b: Vec3, out: Vec3): Vec3 => {
  const x = a.y * b.z - a.z * b.y
  const y = a.z * b.x - a.x * b.z
  const z = a.x * b.y - a.y * b.x
  out.x = x
  out.y = y
  out.z = z
  return out
}
export const normalize = (v: Vec3): Vec3 => {
  const l = length(v)
  if (l > 1e-12) {
    v.x /= l
    v.y /= l
    v.z /= l
  }
  return v
}
