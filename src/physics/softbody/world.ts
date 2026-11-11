/**
 * PhysicsWorld owns bodies + ground and runs substeps. Game-level fixed step
 * (e.g. 120 Hz) × substeps (e.g. 16) ≈ 2 kHz solver rate.
 * Hooks let vehicle systems inject forces each substep (wheels, engine, aero).
 */
import type { SoftBody } from './softbody.ts'
import type { Ground } from './ground.ts'
import { defaultSolverConfig, newStepStats, substep, type SolverConfig, type StepStats } from './solver.ts'

export interface SubstepHook {
  /** Called before solving each substep; add forces into body.force. */
  preSubstep(dt: number): void
}

export interface WorldConfig extends SolverConfig {
  substeps: number
}

export class PhysicsWorld {
  readonly bodies: SoftBody[] = []
  readonly hooks: SubstepHook[] = []
  readonly cfg: WorldConfig
  readonly stats: StepStats = newStepStats()
  time = 0

  constructor(
    public ground: Ground,
    cfg: Partial<WorldConfig> = {},
  ) {
    this.cfg = { ...defaultSolverConfig(), substeps: 16, ...cfg }
  }

  add(b: SoftBody): SoftBody {
    this.bodies.push(b)
    return b
  }

  remove(b: SoftBody): void {
    const i = this.bodies.indexOf(b)
    if (i >= 0) this.bodies.splice(i, 1)
  }

  step(dt: number): void {
    const n = this.cfg.substeps
    const h = dt / n
    this.stats.broken = 0
    this.stats.yielded = 0
    this.stats.contacts = 0
    for (let s = 0; s < n; s++) {
      for (const hook of this.hooks) hook.preSubstep(h)
      for (const b of this.bodies) substep(b, h, this.cfg, this.ground, this.stats)
    }
    this.time += dt
  }
}
