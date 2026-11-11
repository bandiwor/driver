import { describe, expect, it } from 'vitest'
import { buildVehicleBody } from './build.ts'
import { sedan } from './sedan.ts'
import { totalMass } from '../physics/softbody/softbody.ts'
import { computeFrame, newFrame } from '../physics/softbody/frame.ts'
import { Simulation, defaultSimConfig } from '../sim/simulation.ts'

describe('buildVehicleBody', () => {
  it('keeps total mass and orientation (+z forward, +y up)', () => {
    const v = buildVehicleBody(sedan)
    expect(totalMass(v.body)).toBeCloseTo(sedan.mass, 3)
    const f = computeFrame(v.body, v.refs, newFrame())
    expect(f.fz).toBeGreaterThan(0.99)
    expect(f.uy).toBeGreaterThan(0.99)
  })
  it('has one hub + three mounts per wheel; hub moves on a hinge', () => {
    const v = buildVehicleBody(sedan)
    expect(v.corners).toHaveLength(4)
    expect(v.body.nodeCount).toBe(v.shellNodes + 4 * 4)
    const c = v.corners[0]!
    const p = v.body.pos
    // Hinge axis (pivotFront→pivotRear) is along z: hub swings in the x–y plane.
    expect(Math.abs(p[c.pivotFront * 3]! - p[c.pivotRear * 3]!)).toBeLessThan(1e-9)
    expect(p[c.top * 3 + 1]!).toBeGreaterThan(p[c.hub * 3 + 1]!)
  })

  it('stands on its wheels at ride height (full simulation)', () => {
    const sim = new Simulation(defaultSimConfig(sedan.id))
    for (let i = 0; i < 240; i++) sim.step()
    const v = sim.vehicle.vb
    let minShellY = Infinity
    for (let i = 0; i < v.shellNodes; i++) minShellY = Math.min(minShellY, v.body.pos[i * 3 + 1]!)
    expect(minShellY).toBeGreaterThan(0.15)
  })
})
