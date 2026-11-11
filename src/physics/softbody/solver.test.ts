import { describe, expect, it } from 'vitest'
import { BeamFlag, SoftBodyBuilder, centerOfMass, damage } from './softbody.ts'
import { FlatGround } from './ground.ts'
import { PhysicsWorld } from './world.ts'
import { kineticEnergy } from './solver.ts'

const cube = (size = 1, y = 2, spring = 2e5, yieldStrain = Infinity, breakStrain = Infinity) => {
  const b = new SoftBodyBuilder()
  const ids: number[] = []
  for (const x of [0, size]) for (const yy of [y, y + size]) for (const z of [0, size]) ids.push(b.addNode(x, yy, z, { mass: 10 }))
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) b.addBeam(ids[i]!, ids[j]!, { spring, damp: 200, yieldStrain, breakStrain })
  return b.build()
}

const runCube = (): number[] => {
  const w = new PhysicsWorld(new FlatGround(0))
  const b = w.add(cube())
  for (let i = 0; i < 200; i++) w.step(1 / 120)
  return Array.from(b.pos)
}

describe('soft body solver', () => {
  it('builder dedupes beams and computes rest lengths', () => {
    const b = new SoftBodyBuilder()
    b.addNode(0, 0, 0, { mass: 1 })
    b.addNode(3, 4, 0, { mass: 1 })
    expect(b.addBeam(0, 1, { spring: 1, damp: 0 })).toBe(0)
    expect(b.addBeam(1, 0, { spring: 1, damp: 0 })).toBe(-1)
    expect(b.build().rest[0]).toBeCloseTo(5)
  })

  it('free fall matches g·t²/2 (no ground contact)', () => {
    const w = new PhysicsWorld(new FlatGround(-1000), { linearDrag: 0 })
    const body = w.add(cube(1, 0))
    const y0 = centerOfMass(body)[1]!
    for (let i = 0; i < 120; i++) w.step(1 / 120)
    expect(y0 - centerOfMass(body)[1]!).toBeCloseTo(0.5 * 9.81, 1)
  })

  it('comes to rest on the ground without sinking or exploding', () => {
    const w = new PhysicsWorld(new FlatGround(0))
    const body = w.add(cube())
    for (let i = 0; i < 120 * 4; i++) w.step(1 / 120)
    let minY = Infinity
    for (let i = 0; i < body.nodeCount; i++) minY = Math.min(minY, body.pos[i * 3 + 1]!)
    expect(minY).toBeGreaterThan(-0.02)
    expect(kineticEnergy(body)).toBeLessThan(1)
    expect(damage(body)).toBeLessThan(0.01)
  })

  it('a hard impact deforms plastically and breaks weak beams', () => {
    const w = new PhysicsWorld(new FlatGround(0))
    const body = w.add(cube(1, 0.05, 2e4, 0.01, 0.15))
    for (let i = 0; i < body.nodeCount; i++) body.vel[i * 3 + 1] = -25
    for (let i = 0; i < 60; i++) w.step(1 / 120)
    expect(damage(body)).toBeGreaterThan(0.01)
    let broken = 0
    for (let i = 0; i < body.beamCount; i++) if (body.flags[i]! & BeamFlag.Broken) broken++
    expect(broken).toBeGreaterThan(0)
  })

  it('is deterministic', () => {
    expect(runCube()).toEqual(runCube())
  })
})
