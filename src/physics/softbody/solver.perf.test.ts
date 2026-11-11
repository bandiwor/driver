/** Perf budget check. Run: `npm run perf` (PERF=1). Skipped in normal test runs. */
import { describe, expect, it } from 'vitest'
import { PhysicsWorld } from './world.ts'
import { FlatGround } from './ground.ts'
import { buildLattice } from '../../vehicles/lattice.ts'
import { sedan } from '../../vehicles/sedan.ts'

describe.runIf(process.env['PERF'] === '1')('perf', () => {
  it('sedan lattice fits the per-frame physics budget', () => {
    const w = new PhysicsWorld(new FlatGround(0))
    const { body } = buildLattice(sedan.stations, sedan.body, sedan.mass)
    w.add(body)
    for (let i = 0; i < 120; i++) w.step(1 / 120) // warm-up JIT
    const frames = 600
    const t0 = performance.now()
    for (let i = 0; i < frames; i++) w.step(1 / 120)
    const ms = (performance.now() - t0) / frames
    console.info(`[perf] ${body.nodeCount} nodes / ${body.beamCount} beams, 16 substeps: ${ms.toFixed(3)} ms per 120Hz step`)
    // Budget: 120 Hz → 8.3 ms per step; one car must use < 10% of it.
    expect(ms).toBeLessThan(0.83)
  })
})
