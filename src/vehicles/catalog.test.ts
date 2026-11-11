/**
 * Every registered vehicle must be structurally sound and drive plausibly.
 * New cars get these checks for free (garage-wide regression net).
 */
import { describe, expect, it } from 'vitest'
import { listVehicles } from './registry.ts'
import { attachmentSpread, buildVehicleBody } from './build.ts'
import { Simulation, defaultSimConfig } from '../sim/simulation.ts'
import { buildSkin } from '../render/skin.ts'
import { newTelemetry } from './runtime.ts'
import { totalMass } from '../physics/softbody/softbody.ts'
import { powerKw } from '../physics/vehicle/engine.ts'

const HZ = 120
/** Explicit solver substep (120 Hz × 16). */
const H = 1 / (120 * 16)

const vehicles = listVehicles()

describe('garage', () => {
  it('has several distinct vehicles with unique ids', () => {
    expect(vehicles.length).toBeGreaterThanOrEqual(5)
    expect(new Set(vehicles.map((v) => v.id)).size).toBe(vehicles.length)
    expect(new Set(vehicles.map((v) => v.engine.cylinders)).size).toBeGreaterThanOrEqual(3)
    const splits = new Set(vehicles.map((v) => (v.drivetrain.frontSplit === 0 ? 'RWD' : v.drivetrain.frontSplit === 1 ? 'FWD' : 'AWD')))
    expect(splits).toEqual(new Set(['RWD', 'FWD', 'AWD']))
  })
})

describe.each(vehicles.map((v) => [v.id, v] as const))('%s', (_id, def) => {
  it('structure: target mass, valid skin, triangulated suspension mounts', () => {
    const vb = buildVehicleBody(def)
    expect(totalMass(vb.body)).toBeCloseTo(def.mass, 1)
    const skin = buildSkin(vb.map, vb.body.pos)
    expect(skin.nodeOfVertex.length).toBeGreaterThan(100)
    const b = vb.body
    for (const c of vb.corners) {
      for (const n of [c.pivotFront, c.pivotRear, c.top]) {
        const partners: number[] = []
        for (let k = 0; k < b.beamCount; k++) {
          if (b.beamA[k] === n) partners.push(b.beamB[k]!)
          if (b.beamB[k] === n) partners.push(b.beamA[k]!)
        }
        // All three axes stiff (no planar → mechanism attachment).
        expect(attachmentSpread(b.pos, n, partners)).toBeGreaterThan(0.3)
      }
    }
  })

  it('numerics: every node stays well inside the explicit stability limit', () => {
    const b = buildVehicleBody(def).body
    const k = new Float64Array(b.nodeCount)
    for (let i = 0; i < b.beamCount; i++) {
      k[b.beamA[i]!] = k[b.beamA[i]!]! + b.spring[i]!
      k[b.beamB[i]!] = k[b.beamB[i]!]! + b.spring[i]!
    }
    let worst = 0
    for (let n = 0; n < b.nodeCount; n++) worst = Math.max(worst, Math.sqrt(k[n]! * b.invMass[n]!) * H)
    // Symplectic Euler is stable for ω·h < 2; keep a wide margin for damping + nonlinearity.
    expect(worst).toBeLessThan(1.3)
  })

  it('stands still at ride height and drives, brakes and stops plausibly', () => {
    const sim = new Simulation(defaultSimConfig(def.id))
    sim.vehicle.params.set('gear.auto', 1)
    for (let i = 0; i < HZ * 2; i++) sim.step()
    const f = sim.vehicle.frame
    const x0 = f.px
    const z0 = f.pz
    for (let i = 0; i < HZ * 2; i++) sim.step()
    expect(Math.hypot(f.px - x0, f.pz - z0)).toBeLessThan(0.02)
    for (const w of sim.vehicle.wheels) expect(Math.abs(w.compression)).toBeLessThan(0.02)

    sim.controls.throttle = 1
    let t = 0
    while (sim.vehicle.forwardSpeed() * 3.6 < 100 && t < 20) {
      sim.step()
      t += sim.dt
    }
    // Power-to-weight window: anything from a city hatch to a rally car.
    const kwPerTonne = (Math.max(...Array.from({ length: 80 }, (_, i) => powerKw(def.engine, i * 100))) / def.mass) * 1000
    expect(kwPerTonne).toBeGreaterThan(50)
    expect(t).toBeGreaterThan(3)
    expect(t).toBeLessThan(16)

    sim.controls.throttle = 0
    sim.controls.brake = 1
    const zb = f.pz
    while (sim.vehicle.forwardSpeed() > 0.3) sim.step()
    expect(f.pz - zb).toBeLessThan(60)
    expect(sim.vehicle.telemetry(newTelemetry()).damage).toBeLessThan(0.01)
  })

  it('every tuning param applies (min / max / default) without breaking the sim', () => {
    const sim = new Simulation(defaultSimConfig(def.id))
    for (const p of def.params) {
      sim.vehicle.params.set(p.id, p.min)
      sim.vehicle.params.set(p.id, p.max)
      sim.vehicle.params.set(p.id, p.default)
    }
    for (let i = 0; i < HZ; i++) sim.step()
    expect(Number.isFinite(sim.vehicle.frame.py)).toBe(true)
  })
})
