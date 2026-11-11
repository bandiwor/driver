/**
 * Vehicle dynamics "track tests": measured like a car magazine would.
 * Ranges are physical plausibility windows for a ~1.35 t, ~170 kW RWD sedan
 * on road tyres (μ ≈ 1.05), not tuned-to-pass magic numbers.
 */
import { describe, expect, it } from 'vitest'
import { Simulation, defaultSimConfig } from '../sim/simulation.ts'
import { newTelemetry } from './runtime.ts'

const HZ = 120
const tel = newTelemetry()

const make = (): Simulation => {
  const sim = new Simulation(defaultSimConfig('k1-sedan'))
  for (let i = 0; i < HZ * 1.5; i++) sim.step() // settle on the suspension
  return sim
}
const speed = (sim: Simulation): number => sim.vehicle.forwardSpeed()
const heading = (sim: Simulation): number => Math.atan2(sim.vehicle.frame.fx, sim.vehicle.frame.fz)

/** Accelerate (full throttle, straight) until `kmh`; returns elapsed seconds. */
const accelerateTo = (sim: Simulation, kmh: number, limit = 30): number => {
  sim.controls.throttle = 1
  let t = 0
  while (speed(sim) * 3.6 < kmh && t < limit) {
    sim.step()
    t += sim.dt
  }
  sim.controls.throttle = 0
  return t
}

/**
 * Constant steer, speed slowly ramped by a P-controller; returns the peak of
 * the smoothed (EMA, τ≈0.3 s) lateral acceleration of the centre of mass.
 */
function skidpadPeakG(): number {
  const sim = make()
  accelerateTo(sim, 50)
  sim.controls.steer = -0.35
  const f = sim.vehicle.frame
  let target = 50 / 3.6
  let peak = 0
  let ema = 0
  let pvx = f.vx
  let pvz = f.vz
  for (let i = 0; i < HZ * 20; i++) {
    target += 2.5 / 3.6 / HZ // +2.5 km/h per second
    sim.controls.throttle = Math.min(1, Math.max(0, (target - speed(sim)) * 0.6))
    sim.step()
    // Lateral (left) axis on the ground plane: up(0,1,0) × forward.
    const ax = (f.vx - pvx) * HZ
    const az = (f.vz - pvz) * HZ
    pvx = f.vx
    pvz = f.vz
    const fl = Math.hypot(f.fx, f.fz) || 1
    const lat = (ax * f.fz - az * f.fx) / fl
    ema += (Math.abs(lat) - ema) * (1 / (0.3 * HZ))
    if (i > HZ * 2) peak = Math.max(peak, ema)
  }
  return peak / 9.81
}

/** Left–right front compression difference in a steady turn. */
const roll = (spring: number): number => {
  const sim = make()
  sim.vehicle.params.set('susp.front.spring', spring)
  sim.vehicle.params.set('susp.rear.spring', spring)
  accelerateTo(sim, 60)
  sim.controls.steer = 0.25
  sim.controls.throttle = 0.3
  for (let i = 0; i < HZ * 2; i++) sim.step()
  const [fl, fr] = sim.vehicle.wheels
  return Math.abs(fl!.compression - fr!.compression)
}

describe('vehicle dynamics', () => {
  it('stands still without drifting (engine idling in gear)', () => {
    const sim = make()
    const f = sim.vehicle.frame
    const x0 = f.px
    const z0 = f.pz
    for (let i = 0; i < HZ * 5; i++) sim.step()
    expect(Math.hypot(f.px - x0, f.pz - z0)).toBeLessThan(0.02)
    const t = sim.vehicle.telemetry(tel)
    expect(t.rpm).toBeGreaterThan(700)
    expect(t.rpm).toBeLessThan(1100)
  })

  it('rides at design height with plausible static wheel loads', () => {
    const sim = make()
    const loads = sim.vehicle.wheels.map((w) => w.load)
    const total = loads.reduce((a, b) => a + b, 0)
    expect(total / 9.81).toBeGreaterThan(1350 * 0.97)
    expect(total / 9.81).toBeLessThan(1350 * 1.03)
    for (const w of sim.vehicle.wheels) expect(Math.abs(w.compression)).toBeLessThan(0.02)
  })

  it('0–100 km/h in a plausible time with automatic upshifts', () => {
    const sim = make()
    const t = accelerateTo(sim, 100)
    expect(t).toBeGreaterThan(5)
    expect(t).toBeLessThan(10)
    expect(Number(sim.vehicle.telemetry(tel).gear)).toBeGreaterThanOrEqual(3)
  })

  it('tracks straight under full throttle', () => {
    const sim = make()
    const h0 = heading(sim)
    accelerateTo(sim, 120)
    expect(Math.abs(heading(sim) - h0)).toBeLessThan((2 * Math.PI) / 180)
    expect(Math.abs(sim.vehicle.frame.px)).toBeLessThan(0.5)
  })

  it('brakes 100–0 km/h within a road-car distance and stays straight', () => {
    const sim = make()
    accelerateTo(sim, 101)
    const z0 = sim.vehicle.frame.pz
    const h0 = heading(sim)
    sim.controls.brake = 1
    let t = 0
    while (speed(sim) > 0.3 && t < 10) {
      sim.step()
      t += sim.dt
    }
    const d = sim.vehicle.frame.pz - z0
    expect(d).toBeGreaterThan(30)
    expect(d).toBeLessThan(55)
    expect(Math.abs(heading(sim) - h0)).toBeLessThan((5 * Math.PI) / 180)
  })

  it('skidpad: holds a steady circle with road-car lateral g', () => {
    expect(skidpadPeakG()).toBeGreaterThan(0.75)
    expect(skidpadPeakG()).toBeLessThan(1.1) // cannot exceed tyre μ (1.05) by much
  })

  it('steering left turns left (+x is left)', () => {
    const sim = make()
    accelerateTo(sim, 30)
    sim.controls.steer = -0.5 // input −1 = full left
    for (let i = 0; i < HZ; i++) sim.step()
    expect(sim.vehicle.frame.fx).toBeGreaterThan(0.2)
  })

  it('automatic: holding brake at standstill selects reverse and drives backwards', () => {
    const sim = make()
    sim.controls.brake = 1
    for (let i = 0; i < HZ; i++) sim.step()
    expect(sim.vehicle.telemetry(tel).gear).toBe('R')
    for (let i = 0; i < HZ * 2; i++) sim.step()
    expect(speed(sim)).toBeLessThan(-1)
    sim.controls.brake = 0
    sim.controls.throttle = 1
    for (let i = 0; i < HZ * 3; i++) sim.step()
    expect(sim.vehicle.telemetry(tel).gear).not.toBe('R')
  })

  it('manual gearbox: neutral does not drive, first gear does', () => {
    const sim = make()
    sim.vehicle.params.set('gear.auto', 0)
    sim.vehicle.gearbox.gear = 0
    sim.controls.throttle = 1
    for (let i = 0; i < HZ * 2; i++) sim.step()
    expect(Math.abs(speed(sim))).toBeLessThan(0.1)
    expect(sim.vehicle.telemetry(tel).rpm).toBeGreaterThan(5000)
    sim.controls.throttle = 0
    for (let i = 0; i < HZ; i++) sim.step()
    sim.vehicle.shift(1)
    sim.controls.throttle = 1
    for (let i = 0; i < HZ * 2; i++) sim.step()
    expect(speed(sim)).toBeGreaterThan(5)
  })

  it('front-wheel drive split moves the car too; handbrake locks the rears', () => {
    const sim = make()
    sim.vehicle.params.set('drive.split', 1)
    accelerateTo(sim, 40)
    expect(speed(sim) * 3.6).toBeGreaterThan(39)
    sim.controls.handbrake = 1
    for (let i = 0; i < HZ / 2; i++) sim.step()
    const [, , rl, rr] = sim.vehicle.wheels
    expect(Math.abs(rl!.omega)).toBeLessThan(0.5)
    expect(Math.abs(rr!.omega)).toBeLessThan(0.5)
  })

  it('stiffer springs reduce body roll in a turn', () => {
    expect(roll(100000)).toBeLessThan(roll(20000))
  })
})
