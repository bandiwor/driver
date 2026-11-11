import { describe, expect, it } from 'vitest'
import { curve, sample } from './curve.ts'
import { engineRpm, newEngineState, powerKw, stepEngine } from './engine.ts'
import { autoShift, gearRatio, newGearboxState, shift } from './gearbox.ts'
import { magic, tyreForces } from './tyre.ts'
import { sedan } from '../../vehicles/sedan.ts'

describe('curve', () => {
  it('interpolates and clamps', () => {
    const c = curve([[0, 0], [10, 100]])
    expect(sample(c, 5)).toBe(50)
    expect(sample(c, -1)).toBe(0)
    expect(sample(c, 20)).toBe(100)
  })
})

describe('engine', () => {
  const spec = sedan.engine
  it('idles stably without load', () => {
    const s = newEngineState(spec)
    for (let i = 0; i < 2000; i++) stepEngine(spec, s, 0, 0, 1 / 1000)
    expect(engineRpm(s)).toBeGreaterThan(spec.idleRpm * 0.85)
    expect(engineRpm(s)).toBeLessThan(spec.idleRpm * 1.25)
  })
  it('full throttle revs to the limiter and cuts', () => {
    const s = newEngineState(spec)
    let maxRpm = 0
    for (let i = 0; i < 4000; i++) {
      stepEngine(spec, s, 1, 0, 1 / 1000)
      maxRpm = Math.max(maxRpm, engineRpm(s))
    }
    expect(maxRpm).toBeGreaterThan(spec.limiterRpm - 50)
    expect(maxRpm).toBeLessThan(spec.limiterRpm + 300)
  })
  it('has plausible peak power', () => {
    expect(powerKw(spec, 5500)).toBeGreaterThan(120)
  })
})

describe('gearbox', () => {
  const g = sedan.gearbox
  it('ratios include final drive, reverse is negative', () => {
    expect(gearRatio(g, 1)).toBeCloseTo(3.6 * 3.73)
    expect(gearRatio(g, -1)).toBeLessThan(0)
    expect(gearRatio(g, 0)).toBe(0)
  })
  it('shifts within bounds and auto-upshifts', () => {
    const s = newGearboxState()
    expect(shift(g, s, -1)).toBe(true)
    expect(shift(g, s, -1)).toBe(false)
    s.gear = 2
    s.shiftTimer = 0
    autoShift(g, s, 6900, 6500, 2000)
    expect(s.gear).toBe(3)
  })
})

describe('tyre', () => {
  it('magic formula is odd and peaks near D', () => {
    expect(magic(0, 10, 1.9, 1, 0.97)).toBe(0)
    expect(magic(-0.1, 10, 1.9, 1, 0.97)).toBeCloseTo(-magic(0.1, 10, 1.9, 1, 0.97))
    let peak = 0
    for (let s = 0; s < 1; s += 0.001) peak = Math.max(peak, magic(s, 10, 1.9, 1, 0.97))
    expect(peak).toBeCloseTo(1, 2)
  })
  it('combined slip stays inside the friction ellipse', () => {
    const out = { fx: 0, fy: 0 }
    tyreForces(sedan.tyre, 0.15, 0.2, 4000, 1, out)
    expect(Math.hypot(out.fx, out.fy)).toBeLessThanOrEqual(4000 * sedan.tyre.D + 1e-6)
  })
})
