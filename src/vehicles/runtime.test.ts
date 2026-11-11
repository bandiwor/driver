import { describe, expect, it } from 'vitest'
import { Vehicle, newTelemetry } from './runtime.ts'
import { sedan } from './sedan.ts'
import { PhysicsWorld } from '../physics/softbody/world.ts'
import { FlatGround } from '../physics/softbody/ground.ts'

const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0 }

describe('Vehicle runtime', () => {
  it('revs the engine with throttle and applies tuning params live', () => {
    const v = new Vehicle(sedan)
    for (let i = 0; i < 240; i++) v.preStep(1 / 120, { ...idle, throttle: 1 })
    const t = v.telemetry(newTelemetry())
    expect(t.rpm).toBeGreaterThan(5000)
    v.params.set('engine.limiter', 5500)
    expect(v.engineSpec.limiterRpm).toBe(5500)
    v.params.set('engine.torqueScale', 2)
    expect(v.torqueAt(4800)).toBeCloseTo(550)
  })
  it('shifts and resets', () => {
    const w = new PhysicsWorld(new FlatGround(0))
    const v = new Vehicle(sedan, [0, 0.5, 0])
    w.add(v.body)
    v.shift(1)
    expect(v.telemetry(newTelemetry()).gear).toBe('1')
    for (let i = 0; i < 60; i++) {
      v.preStep(1 / 120, idle)
      w.step(1 / 120)
      v.postStep()
    }
    v.reset()
    expect(v.telemetry(newTelemetry()).gear).toBe('N')
    expect(v.frame.py).toBeGreaterThan(0.5)
  })
})
