/**
 * Rigid reference frame extracted from a deformable body: origin = centre of
 * mass, forward/up from reference node groups. Used by cameras, wheels, HUD.
 */
import type { SoftBody } from './softbody.ts'

export interface BodyFrame {
  px: number
  py: number
  pz: number
  fx: number
  fy: number
  fz: number
  ux: number
  uy: number
  uz: number
  /** Velocity of the centre of mass, m/s. */
  vx: number
  vy: number
  vz: number
}

export interface FrameRefs {
  front: readonly number[]
  rear: readonly number[]
  left: readonly number[]
  right: readonly number[]
}

export const newFrame = (): BodyFrame => ({ px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: 1, ux: 0, uy: 1, uz: 0, vx: 0, vy: 0, vz: 0 })

const avg = (b: SoftBody, ids: readonly number[], axis: number): number => {
  let s = 0
  for (const i of ids) s += b.pos[i * 3 + axis]!
  return s / ids.length
}

export function computeFrame(b: SoftBody, refs: FrameRefs, out: BodyFrame): BodyFrame {
  let mx = 0
  let my = 0
  let mz = 0
  let vx = 0
  let vy = 0
  let vz = 0
  let mt = 0
  for (let i = 0; i < b.nodeCount; i++) {
    const m = 1 / b.invMass[i]!
    const i3 = i * 3
    mx += b.pos[i3]! * m
    my += b.pos[i3 + 1]! * m
    mz += b.pos[i3 + 2]! * m
    vx += b.vel[i3]! * m
    vy += b.vel[i3 + 1]! * m
    vz += b.vel[i3 + 2]! * m
    mt += m
  }
  out.px = mx / mt
  out.py = my / mt
  out.pz = mz / mt
  out.vx = vx / mt
  out.vy = vy / mt
  out.vz = vz / mt
  let fx = avg(b, refs.front, 0) - avg(b, refs.rear, 0)
  let fy = avg(b, refs.front, 1) - avg(b, refs.rear, 1)
  let fz = avg(b, refs.front, 2) - avg(b, refs.rear, 2)
  let fl = Math.hypot(fx, fy, fz) || 1
  fx /= fl
  fy /= fl
  fz /= fl
  // right vector, then up = right × forward (right-handed, y-up, +z forward => +x is left).
  const rx = avg(b, refs.right, 0) - avg(b, refs.left, 0)
  const ry = avg(b, refs.right, 1) - avg(b, refs.left, 1)
  const rz = avg(b, refs.right, 2) - avg(b, refs.left, 2)
  let ux = ry * fz - rz * fy
  let uy = rz * fx - rx * fz
  let uz = rx * fy - ry * fx
  fl = Math.hypot(ux, uy, uz) || 1
  ux /= fl
  uy /= fl
  uz /= fl
  out.fx = fx
  out.fy = fy
  out.fz = fz
  out.ux = ux
  out.uy = uy
  out.uz = uz
  return out
}

/** Transform a body-local point (x right? no: x = lateral, y up, z forward) into world space. */
export function localToWorld(f: BodyFrame, x: number, y: number, z: number, out: [number, number, number]): void {
  // lateral axis L = up × forward  (points to +x when f=+z, u=+y)
  const lx = f.uy * f.fz - f.uz * f.fy
  const ly = f.uz * f.fx - f.ux * f.fz
  const lz = f.ux * f.fy - f.uy * f.fx
  out[0] = f.px + lx * x + f.ux * y + f.fx * z
  out[1] = f.py + ly * x + f.uy * y + f.fy * z
  out[2] = f.pz + lz * x + f.uz * y + f.fz * z
}
