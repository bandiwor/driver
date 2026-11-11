/**
 * Builds the physical body of a vehicle from its definition:
 *   lattice shell
 *   + per corner: 3 chassis mount nodes (two lower-arm pivots, strut top)
 *     rigidly tied to the nearest shell nodes,
 *   + a hub node (unsprung mass) on two rigid lower-arm beams.
 * The two arm beams form a hinge along the body's z axis, so the hub has one
 * degree of freedom (an arc → realistic camber gain); the strut spring/damper
 * between hub and top mount is applied as a force by the WheelSystem.
 */
import { SoftBodyBuilder, type SoftBody } from '../physics/softbody/softbody.ts'
import type { FrameRefs } from '../physics/softbody/frame.ts'
import { buildLattice, type LatticeMap } from './lattice.ts'
import type { VehicleDef, WheelDef } from './types.ts'

export interface CornerNodes {
  hub: number
  pivotFront: number
  pivotRear: number
  top: number
}

export interface VehicleBody {
  body: SoftBody
  map: LatticeMap
  refs: FrameRefs
  /** Per wheel (same order as def.wheels). */
  corners: readonly CornerNodes[]
  /** Hub node per wheel (alias of corners[i].hub). */
  wheelNodes: readonly number[]
  /** Number of lattice (shell) nodes; nodes after this are non-visual. */
  shellNodes: number
  /** Number of shell beams (the first beams); used for live body stiffness. */
  shellBeams: number
}

const MOUNT_MASS = 4
const ARM_SPRING = 4e6
const ARM_DAMP = 900
const MOUNT_SPRING = 5e6

const valid = (ids: readonly number[] | undefined): number[] => (ids ?? []).filter((i) => i >= 0)

export const suspensionOf = (def: VehicleDef, w: WheelDef) => (w.axle === 'front' ? def.suspensionFront : def.suspensionRear)

export function buildVehicleBody(def: VehicleDef, stiffness = 1): VehicleBody {
  const corners = def.wheels.length
  const unsprung = def.wheelMass * corners
  const mounts = MOUNT_MASS * 3 * corners
  const lat = buildLattice(def.stations, { ...def.body, spring: def.body.spring * stiffness }, def.mass - unsprung - mounts)
  const shell = lat.body
  const b = new SoftBodyBuilder()
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
  const nearestShell = (x: number, y: number, z: number, n: number): number[] =>
    [...Array(shell.nodeCount).keys()]
      .map((i) => ({ i, d: Math.hypot(shell.pos[i * 3]! - x, shell.pos[i * 3 + 1]! - y, shell.pos[i * 3 + 2]! - z) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, n)
      .map((p) => p.i)
  const mountBeam = { spring: MOUNT_SPRING, damp: 800, yieldStrain: 0.05, breakStrain: 0.5 }
  const armBeam = { spring: ARM_SPRING, damp: ARM_DAMP, yieldStrain: 0.08, breakStrain: 0.6 }
  const out: CornerNodes[] = []
  for (const w of def.wheels) {
    const s = suspensionOf(def, w)
    const side = Math.sign(w.x) || 1
    const ix = w.x - side * s.armLength
    const add = (x: number, y: number, z: number): number => {
      const id = b.addNode(x, y, z, { mass: MOUNT_MASS })
      for (const n of nearestShell(x, y, z, 6)) b.addBeam(id, n, mountBeam)
      return id
    }
    const pivotFront = add(ix, w.y - 0.02, w.z + 0.24)
    const pivotRear = add(ix, w.y - 0.02, w.z - 0.24)
    const top = add(w.x - side * 0.1, w.y + s.strutHeight, w.z)
    b.addBeam(pivotFront, pivotRear, mountBeam)
    b.addBeam(pivotFront, top, mountBeam)
    b.addBeam(pivotRear, top, mountBeam)
    const hub = b.addNode(w.x, w.y, w.z, { mass: def.wheelMass, friction: 0.6 })
    b.addBeam(hub, pivotFront, armBeam)
    b.addBeam(hub, pivotRear, armBeam)
    out.push({ hub, pivotFront, pivotRear, top })
  }
  const st = lat.map.stations
  const side = (parity: 0 | 1): number[] => st.flatMap((s) => s.filter((n, r) => n >= 0 && r % 2 === parity))
  return {
    body: b.build(),
    map: lat.map,
    refs: { front: valid(st[0]), rear: valid(st[st.length - 1]), left: side(0), right: side(1) },
    corners: out,
    wheelNodes: out.map((c) => c.hub),
    shellNodes: shell.nodeCount,
    shellBeams: shell.beamCount,
  }
}
