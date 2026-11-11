/**
 * Procedural body lattice from cross-section stations.
 * Each station has 4 (open) or 6 (with roof) nodes; beams:
 *   - all pairs within a station (rigid ring)
 *   - all pairs between neighbouring stations (shear + bend)
 *   - skip-one longitudinal beams (bending stiffness)
 * Body-local axes: +x = left, +y = up, +z = forward (three.js right-handed).
 * The node map is returned so the renderer can skin a mesh to it.
 */
import { SoftBodyBuilder, type SoftBody } from '../physics/softbody/softbody.ts'
import type { BodyMaterial, BodyStation } from './types.ts'

export const NodeRole = {
  FloorL: 0,
  FloorR: 1,
  BeltL: 2,
  BeltR: 3,
  RoofL: 4,
  RoofR: 5,
} as const
export type NodeRole = (typeof NodeRole)[keyof typeof NodeRole]

export interface LatticeMap {
  /** stations[s][role] = node index or -1 */
  readonly stations: readonly (readonly number[])[]
}

export interface Lattice {
  body: SoftBody
  map: LatticeMap
}

export function stationPoints(s: BodyStation): (readonly [number, number, number] | null)[] {
  const rw = s.roofHalfWidth ?? s.halfWidth * 0.85
  return [
    [s.halfWidth, s.floorY, s.z],
    [-s.halfWidth, s.floorY, s.z],
    [s.halfWidth, s.beltY, s.z],
    [-s.halfWidth, s.beltY, s.z],
    s.roofY === undefined ? null : [rw, s.roofY, s.z],
    s.roofY === undefined ? null : [-rw, s.roofY, s.z],
  ]
}

const valid = (s: readonly number[]): number[] => s.filter((i) => i >= 0)

export function buildLattice(stations: readonly BodyStation[], mat: BodyMaterial, targetMass?: number): Lattice {
  if (stations.length < 2) throw new Error('Need >= 2 stations')
  const b = new SoftBodyBuilder()
  const map: number[][] = []
  const pts = stations.map(stationPoints)
  const count = pts.reduce((n, p) => n + p.filter(Boolean).length, 0)
  const nodeMass = targetMass ? targetMass / count : mat.nodeMass
  for (const sp of pts) {
    map.push(sp.map((p) => (p ? b.addNode(p[0], p[1], p[2], { mass: nodeMass }) : -1)))
  }
  const beam = { spring: mat.spring, damp: mat.damp, yieldStrain: mat.yieldStrain, breakStrain: mat.breakStrain }
  for (let s = 0; s < map.length; s++) {
    const cur = valid(map[s]!)
    for (let i = 0; i < cur.length; i++) for (let j = i + 1; j < cur.length; j++) b.addBeam(cur[i]!, cur[j]!, beam)
    const next = map[s + 1]
    if (next) for (const a of cur) for (const c of valid(next)) b.addBeam(a, c, beam)
    const skip = map[s + 2]
    if (skip) {
      for (let r = 0; r < 6; r++) {
        const a = map[s]![r]!
        const c = skip[r]!
        if (a >= 0 && c >= 0) b.addBeam(a, c, beam)
      }
    }
  }
  return { body: b.build(), map: { stations: map } }
}
