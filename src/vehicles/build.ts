/**
 * Builds the physical body of a vehicle from its definition:
 * lattice shell + per-wheel contact nodes.
 *
 * NOTE (skeleton): wheels are temporary rigid "contact nodes" so the car
 * stands at ride height. Step 2 of the plan replaces them with the real
 * wheel/suspension/tyre model (hub nodes + suspension beams + Pacejka).
 */
import type { SoftBody } from '../physics/softbody/softbody.ts'
import { SoftBodyBuilder } from '../physics/softbody/softbody.ts'
import type { FrameRefs } from '../physics/softbody/frame.ts'
import { buildLattice, stationPoints, type LatticeMap } from './lattice.ts'
import type { VehicleDef } from './types.ts'

export interface VehicleBody {
  body: SoftBody
  map: LatticeMap
  refs: FrameRefs
  /** Contact node index per wheel (same order as def.wheels). */
  wheelNodes: readonly number[]
  /** Number of lattice (shell) nodes; nodes after this are non-visual. */
  shellNodes: number
}

const valid = (ids: readonly number[] | undefined): number[] => (ids ?? []).filter((i) => i >= 0)

export function buildVehicleBody(def: VehicleDef, stiffness = 1): VehicleBody {
  const shellMass = def.mass * 0.9
  const wheelMass = (def.mass * 0.1) / def.wheels.length
  // Build lattice via builder to append wheel nodes in the same body.
  const lat = buildLattice(def.stations, { ...def.body, spring: def.body.spring * stiffness }, shellMass)
  const b = new SoftBodyBuilder()
  const shell = lat.body
  for (let i = 0; i < shell.nodeCount; i++) {
    b.addNode(shell.pos[i * 3]!, shell.pos[i * 3 + 1]!, shell.pos[i * 3 + 2]!, { mass: 1 / shell.invMass[i]! })
  }
  for (let i = 0; i < shell.beamCount; i++) {
    b.addBeam(shell.beamA[i]!, shell.beamB[i]!, {
      spring: shell.spring[i]!,
      damp: shell.damp[i]!,
      yieldStrain: shell.yieldStrain[i]!,
      breakStrain: shell.breakStrain[i]!,
    })
  }
  const wheelNodes: number[] = []
  const strut = { spring: def.suspensionFront.spring * 8, damp: def.suspensionFront.damperBump, breakStrain: 0.6 }
  for (const w of def.wheels) {
    const id = b.addNode(w.x, w.y - def.tyre.radius, w.z, { mass: wheelMass, friction: 1 })
    wheelNodes.push(id)
    // Connect to the 6 nearest shell nodes.
    const near = [...Array(shell.nodeCount).keys()]
      .map((n) => ({ n, d: Math.hypot(shell.pos[n * 3]! - w.x, shell.pos[n * 3 + 1]! - w.y, shell.pos[n * 3 + 2]! - w.z) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 6)
    for (const { n } of near) b.addBeam(id, n, strut)
  }
  const st = lat.map.stations
  const side = (parity: 0 | 1): number[] => st.flatMap((s) => s.filter((n, r) => n >= 0 && r % 2 === parity))
  return {
    body: b.build(),
    map: lat.map,
    refs: { front: valid(st[0]), rear: valid(st[st.length - 1]), left: side(0), right: side(1) },
    wheelNodes,
    shellNodes: shell.nodeCount,
  }
}

export { stationPoints }
