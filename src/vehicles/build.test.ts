import { describe, expect, it } from 'vitest'
import { buildVehicleBody } from './build.ts'
import { sedan } from './sedan.ts'
import { totalMass } from '../physics/softbody/softbody.ts'
import { computeFrame, newFrame } from '../physics/softbody/frame.ts'
import { PhysicsWorld } from '../physics/softbody/world.ts'
import { FlatGround } from '../physics/softbody/ground.ts'

describe('buildVehicleBody', () => {
  it('keeps total mass and orientation (+z forward, +y up)', () => {
    const v = buildVehicleBody(sedan)
    expect(totalMass(v.body)).toBeCloseTo(sedan.mass, 3)
    const f = computeFrame(v.body, v.refs, newFrame())
    expect(f.fz).toBeGreaterThan(0.99)
    expect(f.uy).toBeGreaterThan(0.99)
  })
  it('stands on its wheel contacts at ride height', () => {
    const w = new PhysicsWorld(new FlatGround(0))
    const v = buildVehicleBody(sedan)
    w.add(v.body)
    for (let i = 0; i < 240; i++) w.step(1 / 120)
    let minShellY = Infinity
    for (let i = 0; i < v.shellNodes; i++) minShellY = Math.min(minShellY, v.body.pos[i * 3 + 1]!)
    expect(minShellY).toBeGreaterThan(0.1)
  })
})
