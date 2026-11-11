import { describe, expect, it } from 'vitest'
import { SnapshotSlot, decodeGear, encodeGear, layoutFor, layoutForVehicle, newMeta } from './snapshot.ts'
import { Simulation, defaultSimConfig } from './simulation.ts'
import { Vehicle, newTelemetry } from '../vehicles/runtime.ts'
import { sedan } from '../vehicles/sedan.ts'

describe('snapshot', () => {
  it('layout is 8-byte aligned and sized for nodes + beams', () => {
    const L = layoutFor(40, 298)
    expect(L.bytes % 8).toBe(0)
    expect(L.flagsOff + 298).toBeLessThanOrEqual(L.bytes)
  })
  it('gear encoding round-trips', () => {
    for (const g of ['R', 'N', '1', '6']) expect(decodeGear(encodeGear(g))).toBe(g)
  })
  it('write → read copies body state, frame and telemetry into a shadow vehicle', () => {
    const sim = new Simulation(defaultSimConfig(sedan.id))
    sim.controls.throttle = 1
    for (let i = 0; i < 30; i++) sim.step()
    const L = layoutForVehicle(sim.vehicle)
    const slot = new SnapshotSlot(new ArrayBuffer(L.bytes), 0, L)
    slot.write(sim, 7, 1234.5, 120, newTelemetry())
    const shadow = new Vehicle(sedan)
    const tel = newTelemetry()
    const meta = newMeta()
    slot.read(shadow, tel, meta)
    expect(meta).toMatchObject({ seq: 7, timeMs: 1234.5, stepsPerSec: 120 })
    expect(tel.rpm).toBeCloseTo(sim.vehicle.telemetry(newTelemetry()).rpm, 0)
    expect(shadow.frame.py).toBeCloseTo(sim.vehicle.frame.py, 5)
    expect(shadow.body.pos[5]).toBeCloseTo(sim.vehicle.body.pos[5]!, 5)
    expect(shadow.prevPos[5]).toBeCloseTo(sim.vehicle.prevPos[5]!, 5)
    expect(shadow.wheels[2]!.omega).toBeCloseTo(sim.vehicle.wheels[2]!.omega, 4)
    expect(shadow.wheels[0]!.load).toBeCloseTo(sim.vehicle.wheels[0]!.load, 0)
  })
})
