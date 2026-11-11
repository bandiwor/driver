import { describe, expect, it } from 'vitest'
import { Vehicle, newTelemetry } from './runtime.ts'
import { sedan } from './sedan.ts'
import { Simulation, defaultSimConfig } from '../sim/simulation.ts'

describe('Vehicle runtime', () => {
  it('applies every tuning param of the definition without throwing', () => {
    const v = new Vehicle(sedan)
    for (const d of sedan.params) {
      v.params.set(d.id, d.min)
      v.params.set(d.id, d.max)
      v.params.set(d.id, d.default)
    }
    expect(v.params.toJSON()).toEqual(Object.fromEntries(sedan.params.map((d) => [d.id, d.default])))
  })

  it('wires params into the chassis / powertrain', () => {
    const v = new Vehicle(sedan)
    v.params.set('engine.limiter', 5500)
    expect(v.engineSpec.limiterRpm).toBe(5500)
    v.params.set('engine.torqueScale', 2)
    expect(v.torqueAt(4800)).toBeCloseTo(550)
    v.params.set('susp.front.spring', 80000)
    expect(v.chassis.setup.struts[0]!.spring).toBe(80000)
    expect(v.chassis.setup.struts[2]!.spring).toBe(38000)
    v.params.set('align.front.camber', -3)
    expect(v.chassis.setup.camberLean[0]).toBeCloseTo((-3 * Math.PI) / 180) // left wheel
    expect(v.chassis.setup.camberLean[1]).toBeCloseTo((3 * Math.PI) / 180) // right wheel
    v.params.set('drive.split', 0.4)
    expect(v.chassis.driven(0)).toBe(true)
    const k0 = v.body.spring[0]!
    v.params.set('body.stiffness', 2)
    expect(v.body.spring[0]).toBeCloseTo(k0 * 2)
  })

  it('starts in 1st (automatic) / neutral (manual) and resets', () => {
    const sim = new Simulation(defaultSimConfig(sedan.id))
    const v = sim.vehicle
    expect(v.telemetry(newTelemetry()).gear).toBe('1')
    sim.controls.throttle = 1
    for (let i = 0; i < 240; i++) sim.step()
    expect(v.forwardSpeed()).toBeGreaterThan(5)
    v.params.set('gear.auto', 0)
    v.reset()
    expect(v.telemetry(newTelemetry()).gear).toBe('N')
    expect(v.forwardSpeed()).toBe(0)
    expect(v.wheels.every((w) => w.omega === 0)).toBe(true)
  })
})
