import { describe, expect, it } from 'vitest'
import { ParticleState, newEmit } from './particles.ts'
import { exhaustGrey, tyreSmokeIntensity } from './effects.ts'

describe('ParticleState', () => {
  it('integrates drag + buoyancy and writes render buffers', () => {
    const s = new ParticleState(8)
    s.emit({ ...newEmit(), vx: 10, drag: 1, buoyancy: 2, life: 5, size0: 0.5, size1: 2.5, alpha: 1 })
    s.update(0.1)
    expect(s.live).toBe(1)
    expect(s.pos[0]).toBeCloseTo(0.9, 5) // v damped to 9 then moved
    expect(s.vel[1]).toBeCloseTo(0.2, 5) // rising
    expect(s.outOffset[3]).toBeGreaterThan(0.5) // grew
    expect(s.outColor[3]).toBeGreaterThan(0)
  })
  it('kills expired particles with swap-remove (live range stays contiguous)', () => {
    const s = new ParticleState(8)
    s.emit({ ...newEmit(), life: 0.05, x: 1 })
    s.emit({ ...newEmit(), life: 10, x: 2 })
    s.emit({ ...newEmit(), life: 10, x: 3 })
    s.update(0.1)
    expect(s.live).toBe(2)
    expect([s.pos[0], s.pos[3]].sort()).toEqual([2, 3])
  })
  it('recycles the oldest particle when full', () => {
    const s = new ParticleState(2)
    s.emit({ ...newEmit(), life: 1, x: 1 })
    s.update(0.5)
    s.emit({ ...newEmit(), life: 1, x: 2 })
    s.emit({ ...newEmit(), life: 1, x: 3 }) // replaces x=1 (oldest)
    expect(s.live).toBe(2)
    expect([s.pos[0], s.pos[3]].sort()).toEqual([2, 3])
  })
})

describe('effect mappings', () => {
  it('tyre smoke needs real sliding and load', () => {
    expect(tyreSmokeIntensity(1, 4000, 3500)).toBe(0)
    expect(tyreSmokeIntensity(15, 4000, 3500)).toBeGreaterThan(1)
    expect(tyreSmokeIntensity(15, 0, 3500)).toBe(0)
    expect(tyreSmokeIntensity(6, 3500, 3500)).toBeLessThan(tyreSmokeIntensity(10, 3500, 3500))
  })
  it('exhaust goes from white vapour to black soot', () => {
    expect(exhaustGrey(0)).toBeGreaterThan(0.7)
    expect(exhaustGrey(1)).toBeLessThan(0.15)
  })
})
