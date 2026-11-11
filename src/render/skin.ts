/**
 * Generates a triangle skin over the body lattice. Each output vertex is bound
 * to one physics node (`nodeOfVertex`), so deformation = copying node
 * positions; flat shading via non-indexed geometry. Pure data, testable.
 */
import { NodeRole as R, type LatticeMap } from '../vehicles/lattice.ts'

export const SkinGroup = { Paint: 0, Glass: 1, Under: 2, Interior: 3 } as const
export type SkinGroup = (typeof SkinGroup)[keyof typeof SkinGroup]

export interface Skin {
  /** Physics node per vertex (3 vertices per triangle). */
  nodeOfVertex: Uint32Array
  /** Material group per triangle. */
  groupOfTri: Uint8Array
}

const at = (row: readonly number[], r: number): number => row[r] ?? -1

export function buildSkin(map: LatticeMap, pos: Float64Array): Skin {
  const tris: [number, number, number, SkinGroup][] = []
  const st = map.stations
  const cx = centroid(pos)
  const tri = (a: number, b: number, c: number, g: SkinGroup, inward = false): void => {
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) return
    // Orient outward: normal must point away from the body centroid.
    const n = normal(pos, a, b, c)
    const mx = (pos[a * 3]! + pos[b * 3]! + pos[c * 3]!) / 3 - cx[0]
    const my = (pos[a * 3 + 1]! + pos[b * 3 + 1]! + pos[c * 3 + 1]!) / 3 - cx[1]
    const mz = (pos[a * 3 + 2]! + pos[b * 3 + 2]! + pos[c * 3 + 2]!) / 3 - cx[2]
    if (n[0] * mx + n[1] * my + n[2] * mz < 0 !== inward) tris.push([a, c, b, g])
    else tris.push([a, b, c, g])
  }
  const quad = (a: number, b: number, c: number, d: number, g: SkinGroup, inward = false): void => {
    tri(a, b, c, g, inward)
    tri(a, c, d, g, inward)
  }
  for (let s = 0; s + 1 < st.length; s++) {
    const A = st[s]!
    const B = st[s + 1]!
    quad(at(A, R.FloorL), at(A, R.FloorR), at(B, R.FloorR), at(B, R.FloorL), SkinGroup.Under)
    quad(at(A, R.FloorL), at(A, R.BeltL), at(B, R.BeltL), at(B, R.FloorL), SkinGroup.Paint)
    quad(at(A, R.FloorR), at(A, R.BeltR), at(B, R.BeltR), at(B, R.FloorR), SkinGroup.Paint)
    const aRoof = at(A, R.RoofL) >= 0
    const bRoof = at(B, R.RoofL) >= 0
    if (aRoof || bRoof) {
      // Door cards: inner side walls of the cabin.
      quad(at(A, R.FloorL), at(A, R.BeltL), at(B, R.BeltL), at(B, R.FloorL), SkinGroup.Interior, true)
      quad(at(A, R.FloorR), at(A, R.BeltR), at(B, R.BeltR), at(B, R.FloorR), SkinGroup.Interior, true)
    }
    if (aRoof && bRoof) {
      quad(at(A, R.BeltL), at(A, R.RoofL), at(B, R.RoofL), at(B, R.BeltL), SkinGroup.Glass)
      quad(at(A, R.BeltR), at(A, R.RoofR), at(B, R.RoofR), at(B, R.BeltR), SkinGroup.Glass)
      quad(at(A, R.RoofL), at(A, R.RoofR), at(B, R.RoofR), at(B, R.RoofL), SkinGroup.Paint)
      // Cabin floor + headliner seen from inside (cockpit camera).
      quad(at(A, R.FloorL), at(A, R.FloorR), at(B, R.FloorR), at(B, R.FloorL), SkinGroup.Interior, true)
      quad(at(A, R.RoofL), at(A, R.RoofR), at(B, R.RoofR), at(B, R.RoofL), SkinGroup.Interior, true)
    } else if (!aRoof && !bRoof) {
      quad(at(A, R.BeltL), at(A, R.BeltR), at(B, R.BeltR), at(B, R.BeltL), SkinGroup.Paint)
    } else {
      // Windshield / rear window: open station (belt) -> roofed station (roof).
      const O = aRoof ? B : A
      const C = aRoof ? A : B
      quad(at(O, R.BeltL), at(O, R.BeltR), at(C, R.RoofR), at(C, R.RoofL), SkinGroup.Glass)
      tri(at(O, R.BeltL), at(C, R.BeltL), at(C, R.RoofL), SkinGroup.Glass)
      tri(at(O, R.BeltR), at(C, R.BeltR), at(C, R.RoofR), SkinGroup.Glass)
      // Bulkhead (firewall / rear seat back) closing the cabin, faces inward;
      // plus the floor of this transition segment.
      quad(at(O, R.FloorL), at(O, R.FloorR), at(O, R.BeltR), at(O, R.BeltL), SkinGroup.Interior, true)
      quad(at(A, R.FloorL), at(A, R.FloorR), at(B, R.FloorR), at(B, R.FloorL), SkinGroup.Interior, true)
    }
  }
  for (const row of [st[0], st[st.length - 1]]) {
    if (!row) continue
    const r = (i: number): number => row[i] ?? -1
    quad(r(R.FloorL), r(R.FloorR), r(R.BeltR), r(R.BeltL), SkinGroup.Paint)
    if (r(R.RoofL) >= 0) quad(r(R.BeltL), r(R.BeltR), r(R.RoofR), r(R.RoofL), SkinGroup.Glass)
  }
  // Sort by group so the GPU draws each material in one contiguous range.
  tris.sort((p, q) => p[3] - q[3])
  const nodeOfVertex = new Uint32Array(tris.length * 3)
  const groupOfTri = new Uint8Array(tris.length)
  tris.forEach(([a, b, c, g], i) => {
    nodeOfVertex[i * 3] = a
    nodeOfVertex[i * 3 + 1] = b
    nodeOfVertex[i * 3 + 2] = c
    groupOfTri[i] = g
  })
  return { nodeOfVertex, groupOfTri }
}

const centroid = (p: Float64Array): [number, number, number] => {
  const n = p.length / 3
  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < n; i++) {
    x += p[i * 3]!
    y += p[i * 3 + 1]!
    z += p[i * 3 + 2]!
  }
  return [x / n, y / n, z / n]
}

const normal = (p: Float64Array, a: number, b: number, c: number): [number, number, number] => {
  const ux = p[b * 3]! - p[a * 3]!
  const uy = p[b * 3 + 1]! - p[a * 3 + 1]!
  const uz = p[b * 3 + 2]! - p[a * 3 + 2]!
  const vx = p[c * 3]! - p[a * 3]!
  const vy = p[c * 3 + 1]! - p[a * 3 + 1]!
  const vz = p[c * 3 + 2]! - p[a * 3 + 2]!
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}
