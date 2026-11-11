import { describe, expect, it } from 'vitest'
import { buildLattice } from './lattice.ts'
import { sedan } from './sedan.ts'
import { totalMass, damage } from '../physics/softbody/softbody.ts'
import { PhysicsWorld } from '../physics/softbody/world.ts'
import { FlatGround } from '../physics/softbody/ground.ts'
import { kineticEnergy } from '../physics/softbody/solver.ts'

describe('vehicle lattice', () => {
  it('hits target mass and has a node map per station', () => {
    const { body, map } = buildLattice(sedan.stations, sedan.body, sedan.mass)
    expect(totalMass(body)).toBeCloseTo(sedan.mass, 3)
    expect(map.stations).toHaveLength(sedan.stations.length)
    expect(body.beamCount).toBeGreaterThan(body.nodeCount * 3)
  })
  it('sedan body settles on the ground stably', () => {
    const w = new PhysicsWorld(new FlatGround(0))
    const { body } = buildLattice(sedan.stations, sedan.body, sedan.mass)
    w.add(body)
    for (let i = 0; i < 120 * 3; i++) w.step(1 / 120)
    expect(kineticEnergy(body)).toBeLessThan(5)
    expect(damage(body)).toBeLessThan(0.005)
  })
})
