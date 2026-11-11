/**
 * World + destruction integration tests: real Simulation on small test maps
 * (maps are plain data, registered on the fly).
 */
import { describe, expect, it } from 'vitest'
import { Simulation, defaultSimConfig } from './simulation.ts'
import { registerMap } from '../world/maps/registry.ts'
import type { MapDef } from '../world/map.ts'
import { newTelemetry } from '../vehicles/runtime.ts'
import { BeamFlag } from '../physics/softbody/softbody.ts'

const HZ = 120
const tel = newTelemetry()
const run = (s: Simulation, seconds: number): void => {
  for (let i = 0; i < HZ * seconds; i++) s.step()
}

const testMap = (id: string, m: Partial<MapDef>): string => {
  registerMap({
    id,
    name: id,
    description: '',
    size: 400,
    cell: 2,
    baseHeight: 0,
    baseSurface: 'asphalt',
    features: [],
    objects: [],
    spawns: [{ id: 'start', name: 'start', x: 0, z: 0, yaw: 0 }],
    ...m,
  })
  return id
}

// Wall 12 m ahead of the spawn (car faces +z).
testMap('t-wall', { objects: [{ x: 0, z: 12, width: 12, height: 2.2, length: 1.2, yaw: 0, material: 'concrete' }] })
// One long strip per surface, car spawns at the start of each.
const STRIPS = ['asphalt', 'gravel', 'ice', 'mud'] as const
testMap('t-surfaces', {
  features: STRIPS.map((s, i) => ({ kind: 'paint' as const, shape: { type: 'rect' as const, x: -60 + i * 40, z: 50, width: 30, length: 300 }, surface: s })),
  spawns: STRIPS.map((s, i) => ({ id: s, name: s, x: -60 + i * 40, z: -80, yaw: 0 })),
})
// 18° incline along +z starting at z = 10.
testMap('t-slope', {
  features: [{ kind: 'ramp', x: 0, z: 10, yaw: 0, width: 12, length: 30, height: 30 * Math.tan((18 * Math.PI) / 180), top: 20 }],
  spawns: [
    { id: 'start', name: 'start', x: 0, z: 0, yaw: 0 },
    { id: 'on', name: 'on slope', x: 0, z: 22, yaw: 0 },
  ],
})
// Kicker jump.
testMap('t-jump', { features: [{ kind: 'ramp', x: 0, z: 25, yaw: 0, width: 8, length: 8, height: 1.5, kicker: true, back: 2 }] })

/** Give the whole car a forward speed (crash tests without a long run-up). */
const launchAt = (s: Simulation, kmh: number): void => {
  const b = s.vehicle.body
  const f = s.vehicle.frame
  for (let n = 0; n < b.nodeCount; n++) {
    b.vel[n * 3] = (f.fx * kmh) / 3.6
    b.vel[n * 3 + 2] = (f.fz * kmh) / 3.6
  }
  for (const w of s.vehicle.wheels) w.omega = kmh / 3.6 / s.vehicle.def.tyre.radius
  s.vehicle.params.set('gear.auto', 0)
  s.vehicle.gearbox.gear = 0
}

/** Mean plastic strain of shell beams whose design z is in (lo, hi). */
const zoneStrain = (s: Simulation, lo: number, hi: number): number => {
  const b = s.vehicle.body
  let sum = 0
  let n = 0
  for (let i = 0; i < s.vehicle.vb.shellBeams; i++) {
    const z = (b.pos0[b.beamA[i]! * 3 + 2]! + b.pos0[b.beamB[i]! * 3 + 2]!) / 2
    if (z <= lo || z >= hi) continue
    n++
    sum += b.flags[i]! & BeamFlag.Broken ? 0.25 : Math.abs(b.rest[i]! - b.rest0[i]!) / b.rest0[i]!
  }
  return sum / n
}

const crash = (kmh: number): Simulation => {
  const s = new Simulation(defaultSimConfig('k1-sedan', 't-wall'))
  run(s, 1)
  launchAt(s, kmh)
  run(s, 2)
  return s
}

describe('destruction', () => {
  it('crumple zone absorbs a frontal crash; the cabin cage stays intact', () => {
    const s = crash(60)
    const front = zoneStrain(s, 1.2, 9)
    const cabin = zoneStrain(s, -0.8, 0.5)
    expect(front).toBeGreaterThan(0.02)
    expect(cabin).toBeLessThan(front * 0.1)
    expect(s.vehicle.telemetry(tel).damage).toBeGreaterThan(0.005)
    expect(Number.isFinite(s.vehicle.frame.px)).toBe(true)
  })

  it('engine damage scales with impact speed: scratch vs. destroyed', () => {
    expect(crash(25).vehicle.engine.health).toBeGreaterThan(0.9)
    const hard = crash(100)
    expect(hard.vehicle.engine.health).toBeLessThan(0.12)
    expect(hard.vehicle.engine.running).toBe(false)
  })

  it('a destroyed engine will not start; repair (reset) restores it', () => {
    const s = crash(100)
    s.controls.starter = 1
    run(s, 1.5)
    expect(s.vehicle.engine.running).toBe(false)
    s.controls.starter = 0
    s.vehicle.reset()
    expect(s.vehicle.engine.health).toBe(1)
    expect(s.vehicle.telemetry(tel).damage).toBe(0)
  })

  it('breaking both lower arms tears the wheel off (no strut, no drive)', () => {
    const s = new Simulation(defaultSimConfig('k1-sedan'))
    run(s, 1)
    const c = s.vehicle.vb.corners[0]!
    const b = s.vehicle.body
    for (const arm of c.arms) b.flags[arm] = b.flags[arm]! | BeamFlag.Broken
    run(s, 1.5)
    expect(s.vehicle.wheels[0]!.detached).toBe(true)
    expect(s.vehicle.telemetry(tel).wheelsOff).toBe(1)
    // Corner drops onto the ground: body sits lower on that side.
    let minY = Infinity
    for (let i = 0; i < s.vehicle.vb.shellNodes; i++) minY = Math.min(minY, b.pos[i * 3 + 1]!)
    expect(minY).toBeLessThan(0.12)
  })

  it('crashes produce impact events', () => {
    const s = new Simulation(defaultSimConfig('k1-sedan', 't-wall'))
    run(s, 1)
    launchAt(s, 60)
    let maxHit = 0
    for (let i = 0; i < HZ * 1.5; i++) maxHit = Math.max(maxHit, s.step())
    expect(maxHit).toBeGreaterThan(0.5)
  })
})

/** Brake from 60 km/h on a surface strip; returns stopping distance. */
const braking = (surface: (typeof STRIPS)[number]): number => {
  const s = new Simulation(defaultSimConfig('k1-sedan', 't-surfaces', surface))
  run(s, 1)
  launchAt(s, 60)
  run(s, 0.1)
  const z0 = s.vehicle.frame.pz
  s.controls.brake = 1
  let t = 0
  while (s.vehicle.forwardSpeed() > 0.3 && t < 30) {
    s.step()
    t += s.dt
  }
  return s.vehicle.frame.pz - z0
}

/** Speed after coasting 3 s from 40 km/h on a surface strip. */
const coast = (surface: (typeof STRIPS)[number]): number => {
  const s = new Simulation(defaultSimConfig('k1-sedan', 't-surfaces', surface))
  run(s, 1)
  launchAt(s, 40)
  run(s, 3)
  return s.vehicle.forwardSpeed()
}

describe('surfaces', () => {
  it('stopping distance: asphalt < gravel < ice', () => {
    const asphalt = braking('asphalt')
    const gravel = braking('gravel')
    const ice = braking('ice')
    expect(gravel).toBeGreaterThan(asphalt * 1.2)
    expect(ice).toBeGreaterThan(asphalt * 4)
  })
  it('mud drags: coasting stops much sooner than on asphalt', () => {
    // Extra rolling resistance 0.14 → ≈1.4 m/s² → ≥ 2.5 m/s more lost in 3 s.
    expect(coast('mud')).toBeLessThan(coast('asphalt') - 2.5)
  })
  it('wheels report the surface under them', () => {
    const s = new Simulation(defaultSimConfig('k1-sedan', 't-surfaces', 'ice'))
    run(s, 1)
    expect(new Set(s.vehicle.wheels.map((w) => w.surface)).size).toBe(1)
    expect(s.vehicle.wheels[0]!.surface).not.toBe(0)
  })
})

describe('terrain', () => {
  it('on an 18° slope the car rolls back without brakes and holds with them', () => {
    const free = new Simulation(defaultSimConfig('k1-sedan', 't-slope', 'on'))
    free.vehicle.params.set('gear.auto', 0)
    free.vehicle.gearbox.gear = 0
    run(free, 2)
    expect(free.vehicle.forwardSpeed()).toBeLessThan(-1)
    // Manual in neutral: in automatic, holding the brake at a standstill selects reverse.
    const held = new Simulation(defaultSimConfig('k1-sedan', 't-slope', 'on'))
    held.vehicle.params.set('gear.auto', 0)
    held.vehicle.gearbox.gear = 0
    held.controls.brake = 1
    run(held, 2)
    expect(Math.abs(held.vehicle.forwardSpeed())).toBeLessThan(0.2)
  })
  it('can drive up the slope', () => {
    const s = new Simulation(defaultSimConfig('k1-sedan', 't-slope'))
    s.controls.throttle = 1
    run(s, 6)
    expect(s.vehicle.frame.py).toBeGreaterThan(4)
  })
  it('a kicker launches the car into the air and it lands in one piece', () => {
    const s = new Simulation(defaultSimConfig('k1-sedan', 't-jump'))
    run(s, 0.5)
    launchAt(s, 55)
    s.vehicle.params.set('gear.auto', 1)
    let airborne = 0
    for (let i = 0; i < HZ * 4; i++) {
      s.step()
      if (s.vehicle.wheels.every((w) => !w.contact) && s.vehicle.frame.pz > 25) airborne++
    }
    expect(airborne / HZ).toBeGreaterThan(0.25)
    expect(Number.isFinite(s.vehicle.frame.py)).toBe(true)
    expect(s.vehicle.telemetry(tel).wheelsOff).toBe(0)
  })
  it('teleport places the car at another spawn, repaired', () => {
    const s = crash(60)
    s.apply({ type: 'teleport', spawn: 'start' })
    run(s, 1)
    expect(s.vehicle.telemetry(tel).damage).toBe(0)
    expect(Math.abs(s.vehicle.frame.pz)).toBeLessThan(0.5)
  })
})
