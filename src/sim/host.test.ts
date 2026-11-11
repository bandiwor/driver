import { afterEach, describe, expect, it } from 'vitest'
import { InlineHost, WorkerHost } from './host.ts'
import { SimServer } from './server.ts'
import { defaultSimConfig, newControls } from './simulation.ts'
import type { Endpoint, Transport } from './protocol.ts'

const cfg = defaultSimConfig('k1-sedan')
const disposers: (() => void)[] = []
afterEach(() => {
  while (disposers.length) disposers.pop()?.()
})

/** Runs the worker server in-process over a MessageChannel (manual clock). */
async function connect(transport: Transport): Promise<{ host: WorkerHost; server: SimServer }> {
  const { port1, port2 } = new MessageChannel()
  const server = new SimServer(port2 as unknown as Endpoint)
  const host = await WorkerHost.create(port1 as unknown as Endpoint, cfg, {
    transport,
    clock: 'manual',
    onDispose: () => {
      port1.close()
      port2.close()
    },
  })
  disposers.push(() => host.dispose())
  return { host, server }
}

const drive = { ...newControls(), throttle: 1 }

/**
 * Transfer transport is eventually consistent: buffers ping-pong between the
 * threads over several event-loop turns before the newest state is visible.
 */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

describe.each<Transport>(['shared', 'transfer'])('WorkerHost (%s)', (transport) => {
  it('reproduces the inline simulation exactly (f32 precision)', async () => {
    const inline = new InlineHost(cfg)
    const { host } = await connect(transport)
    inline.setControls(drive)
    host.setControls(drive)
    for (let i = 0; i < 90; i++) inline.fixedUpdate()
    await host.step(90)
    await flush()
    host.sync(0)
    inline.sync(0, 1)
    const a = inline.vehicle.body.pos
    const b = host.vehicle.body.pos
    for (let i = 0; i < a.length; i++) expect(b[i]).toBeCloseTo(a[i]!, 4)
    expect(host.telemetry.rpm).toBeCloseTo(inline.telemetry.rpm, 0)
    expect(host.vehicle.frame.py).toBeCloseTo(inline.vehicle.frame.py, 4)
    expect(host.vehicle.prevPos).not.toEqual(host.vehicle.body.pos)
  })

  it('forwards commands and tuning params to the worker', async () => {
    const { host, server } = await connect(transport)
    host.vehicle.params.set('gear.auto', 0) // manual, still in 1st (auto start gear)
    host.setControls({ ...newControls(), clutch: 1 })
    await host.step(40) // clutch pedal down → disengaged
    host.command({ type: 'shift', delta: 1 })
    host.vehicle.params.set('engine.limiter', 5000)
    await host.step(1)
    await flush()
    host.sync(0)
    expect(host.telemetry.gear).toBe('2')
    expect(server.simulation?.vehicle.engineSpec.limiterRpm).toBe(5000)
    expect(server.simulation?.vehicle.automatic).toBe(false)
  })

  it('reports impacts and broken beams from the worker', async () => {
    const { host } = await connect(transport)
    const hits: number[] = []
    host.onImpact((s) => hits.push(s))
    const n = host.vehicle.body.nodeCount
    for (let i = 0; i < n; i++) host.command({ type: 'kick', node: i, v: [0, -60, 0] })
    await host.step(30)
    await flush()
    host.sync(0)
    expect(hits.length).toBeGreaterThan(0)
    expect(host.telemetry.damage).toBeGreaterThan(0)
    expect(Array.from(host.vehicle.body.flags).some((f) => f & 1)).toBe(true)
  })
})

describe('InlineHost', () => {
  it('steps on fixedUpdate and passes the loop alpha through', () => {
    const h = new InlineHost(cfg)
    h.setControls(drive)
    for (let i = 0; i < 180; i++) h.fixedUpdate()
    h.sync(0, 0.25)
    expect(h.alpha).toBe(0.25)
    expect(h.telemetry.speedKmh).toBeGreaterThan(10)
  })
})
