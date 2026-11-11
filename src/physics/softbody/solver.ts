/**
 * Explicit node–beam solver: semi-implicit (symplectic) Euler at high rate
 * (~2 kHz). Per substep:
 *   1. clear forces, apply gravity
 *   2. beam spring + damper forces, plastic yield, breaking
 *   3. integrate v += F/m·dt, x += v·dt
 *   4. ground contact: projection + restitution + Coulomb friction
 * Allocation-free. Hand-inlined index math on purpose (hot loop).
 */
import { BeamFlag, type SoftBody } from './softbody.ts'
import { newGroundSample, type Ground, type StaticColliders } from './ground.ts'

export interface SolverConfig {
  gravity: number // m/s², positive = down
  restitution: number
  /** Global velocity damping per second (air drag proxy), 0..1. */
  linearDrag: number
}

export const defaultSolverConfig = (): SolverConfig => ({ gravity: 9.81, restitution: 0.05, linearDrag: 0.01 })

export interface StepStats {
  broken: number
  yielded: number
  contacts: number
  /** Strongest inward contact speed this step (ground or obstacle), m/s. */
  impact: number
}

const gs = newGroundSample()

export function computeBeamForces(b: SoftBody, stats: StepStats): void {
  const { pos, vel, force, beamA, beamB, rest, rest0, spring, damp, yieldStrain, breakStrain, flags } = b
  for (let i = 0, m = b.beamCount; i < m; i++) {
    const fl = flags[i]!
    if (fl & BeamFlag.Broken) continue
    const a3 = beamA[i]! * 3
    const b3 = beamB[i]! * 3
    const dx = pos[b3]! - pos[a3]!
    const dy = pos[b3 + 1]! - pos[a3 + 1]!
    const dz = pos[b3 + 2]! - pos[a3 + 2]!
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (L < 1e-9) continue
    const inv = 1 / L
    const nx = dx * inv
    const ny = dy * inv
    const nz = dz * inv
    let L0 = rest[i]!
    const R0 = rest0[i]!
    // Break on total strain vs. the original length; yield on elastic strain.
    const total = (L - R0) / R0
    if ((total < 0 ? -total : total) > breakStrain[i]!) {
      flags[i] = fl | BeamFlag.Broken
      stats.broken++
      continue
    }
    const strain = (L - L0) / R0
    const ys = yieldStrain[i]!
    if ((strain < 0 ? -strain : strain) > ys) {
      // Plastic flow: drag rest length so that elastic strain stays at the yield limit.
      L0 = L - (strain > 0 ? ys : -ys) * R0
      rest[i] = L0
      stats.yielded++
    }
    const ext = L - L0
    if (fl & BeamFlag.CompressionOnly && ext > 0) continue
    const rvx = vel[b3]! - vel[a3]!
    const rvy = vel[b3 + 1]! - vel[a3 + 1]!
    const rvz = vel[b3 + 2]! - vel[a3 + 2]!
    const vRel = rvx * nx + rvy * ny + rvz * nz
    const f = spring[i]! * ext + damp[i]! * vRel
    const fx = f * nx
    const fy = f * ny
    const fz = f * nz
    force[a3] = force[a3]! + fx
    force[a3 + 1] = force[a3 + 1]! + fy
    force[a3 + 2] = force[a3 + 2]! + fz
    force[b3] = force[b3]! - fx
    force[b3 + 1] = force[b3 + 1]! - fy
    force[b3 + 2] = force[b3 + 2]! - fz
  }
}

export function integrate(
  b: SoftBody,
  dt: number,
  cfg: SolverConfig,
  ground: Ground,
  stats: StepStats,
  colliders: StaticColliders | null = null,
): void {
  const { pos, vel, force, invMass, nodeFriction } = b
  const drag = Math.max(0, 1 - cfg.linearDrag * dt)
  const g = cfg.gravity
  for (let i = 0, n = b.nodeCount; i < n; i++) {
    const i3 = i * 3
    const im = invMass[i]!
    let vx = (vel[i3]! + force[i3]! * im * dt) * drag
    let vy = (vel[i3 + 1]! + (force[i3 + 1]! * im - g) * dt) * drag
    let vz = (vel[i3 + 2]! + force[i3 + 2]! * im * dt) * drag
    let x = pos[i3]! + vx * dt
    let y = pos[i3 + 1]! + vy * dt
    let z = pos[i3 + 2]! + vz * dt

    ground.sample(x, z, gs)
    const depth = gs.height - y
    if (depth > 0) {
      stats.contacts++
      // Project out along normal (approx: for gentle slopes vertical ≈ normal).
      x += gs.nx * depth * gs.ny
      y += depth * gs.ny * gs.ny
      z += gs.nz * depth * gs.ny
      const vn = vx * gs.nx + vy * gs.ny + vz * gs.nz
      if (vn < 0) {
        if (-vn > stats.impact) stats.impact = -vn
        // Remove normal velocity (+restitution) and apply Coulomb friction.
        const jn = -vn * (1 + cfg.restitution)
        vx += jn * gs.nx
        vy += jn * gs.ny
        vz += jn * gs.nz
        const vnn = vx * gs.nx + vy * gs.ny + vz * gs.nz
        const tx = vx - vnn * gs.nx
        const ty = vy - vnn * gs.ny
        const tz = vz - vnn * gs.nz
        const vt = Math.sqrt(tx * tx + ty * ty + tz * tz)
        if (vt > 1e-9) {
          const mu = nodeFriction[i]! * gs.friction
          const k = Math.min(1, (mu * jn) / vt)
          vx -= tx * k
          vy -= ty * k
          vz -= tz * k
        }
      }
    }
    pos[i3] = x
    pos[i3 + 1] = y
    pos[i3 + 2] = z
    vel[i3] = vx
    vel[i3 + 1] = vy
    vel[i3 + 2] = vz
    force[i3] = 0
    force[i3 + 1] = 0
    force[i3 + 2] = 0
    if (colliders) {
      const hit = colliders.collide(pos, vel, i3, nodeFriction[i]!)
      if (hit > stats.impact) stats.impact = hit
    }
  }
}

/** One substep. External forces may be accumulated into `b.force` before calling. */
export function substep(
  b: SoftBody,
  dt: number,
  cfg: SolverConfig,
  ground: Ground,
  stats: StepStats,
  colliders: StaticColliders | null = null,
): void {
  computeBeamForces(b, stats)
  integrate(b, dt, cfg, ground, stats, colliders)
}

export const newStepStats = (): StepStats => ({ broken: 0, yielded: 0, contacts: 0, impact: 0 })

export const kineticEnergy = (b: SoftBody): number => {
  let e = 0
  for (let i = 0; i < b.nodeCount; i++) {
    const i3 = i * 3
    const v2 = b.vel[i3]! ** 2 + b.vel[i3 + 1]! ** 2 + b.vel[i3 + 2]! ** 2
    e += (0.5 * v2) / b.invMass[i]!
  }
  return e
}
