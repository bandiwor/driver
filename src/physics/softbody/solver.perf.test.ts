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

  it('main thread: pulling a worker snapshot costs a few microseconds', async () => {
    const { WorkerHost } = await import('../../sim/host.ts')
    const { SimServer } = await import('../../sim/server.ts')
    const { defaultSimConfig } = await import('../../sim/simulation.ts')
    const { port1, port2 } = new MessageChannel()
    // oxlint-disable-next-line no-new
    new SimServer(port2 as never)
    const host = await WorkerHost.create(port1 as never, defaultSimConfig('k1-sedan'), { transport: 'shared', clock: 'manual' })
    await host.step(1)
    const n = 20_000
    const t0 = performance.now()
    for (let i = 0; i < n; i++) host.sync(i)
    const us = ((performance.now() - t0) / n) * 1000
    console.info(`[perf] WorkerHost.sync (shared, no new data): ${us.toFixed(2)} µs`)
    expect(us).toBeLessThan(20)
    host.dispose()
    port1.close()
    port2.close()
  })
})
