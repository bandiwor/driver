import { describe, expect, it } from 'vitest'
import { newDrivelineState, solveDriveline, type DrivelineWheel } from './driveline.ts'
import { antiRollForce, preloadedRestLength, strutForce, type StrutSpec } from './suspension.ts'
import { ackermannAngle, wheelSteerAngle } from './steering.ts'
import { slipAngle, slipRatio, tyreForces2, type TyreInput } from './tyre.ts'
import { sedan } from '../../vehicles/sedan.ts'

const wheel = (o: Partial<DrivelineWheel> = {}): DrivelineWheel => ({
  omega: 0,
  inertia: 1,
  k: 0,
  fx: 0,
  radius: 0.3,
  share: 0.5,
  brake: 0,
  a: 0,
  b: 0,
  ...o,
})

describe('driveline', () => {
  const h = 1 / 2000
  it('locked clutch: engine and carrier turn together, energy flows to wheels', () => {
    const ws = [wheel(), wheel()]
    const st = newDrivelineState(100)
    for (let i = 0; i < 2000; i++) {
      solveDriveline({ h, engineTorque: 200, engineInertia: 0.2, ratio: 10, clutchCapacity: 1e5 }, ws, [], st)
    }
    expect(st.locked).toBe(true)
    const carrier = (ws[0]!.omega + ws[1]!.omega) / 2
    expect(st.engineOmega).toBeCloseTo(10 * carrier, 6)
    // Rigid system: I_eff = Ie·G² + ΣIw → α = Te·G / I_eff at the carrier.
    const ieff = 0.2 * 100 + 2
    expect(carrier).toBeGreaterThan(((200 * 10) / ieff) * 1 * 0.95)
  })

  it('slipping clutch transmits exactly its capacity', () => {
    const ws = [wheel(), wheel()]
    const st = newDrivelineState(300)
    solveDriveline({ h, engineTorque: 0, engineInertia: 0.2, ratio: 10, clutchCapacity: 50 }, ws, [], st)
    expect(st.locked).toBe(false)
    expect(st.clutchTorque).toBeCloseTo(50)
  })

  it('open diff splits torque equally; a wheel in the air spins up', () => {
    const ws = [wheel({ k: 0 }), wheel({ k: 5000, fx: 0 })]
    const st = newDrivelineState(200)
    for (let i = 0; i < 200; i++) solveDriveline({ h, engineTorque: 150, engineInertia: 0.2, ratio: 8, clutchCapacity: 1e5 }, ws, [], st)
    expect(ws[0]!.omega).toBeGreaterThan(ws[1]!.omega * 2)
  })

  it('a locked diff keeps both wheels at the same speed', () => {
    const ws = [wheel({ k: 0 }), wheel({ k: 5000 })]
    const st = newDrivelineState(200)
    for (let i = 0; i < 200; i++)
      solveDriveline({ h, engineTorque: 150, engineInertia: 0.2, ratio: 8, clutchCapacity: 1e5 }, ws, [[0, 1, Infinity]], st)
    expect(ws[0]!.omega).toBeCloseTo(ws[1]!.omega, 6)
  })

  it('brakes stop a wheel and never reverse it', () => {
    const ws = [wheel({ omega: 10, share: 0, brake: 2000 })]
    const st = newDrivelineState(0)
    for (let i = 0; i < 100; i++) solveDriveline({ h, engineTorque: 0, engineInertia: 0.2, ratio: 0, clutchCapacity: 0 }, ws, [], st)
    expect(ws[0]!.omega).toBe(0)
  })

  it('is stable with a very stiff tyre at low speed (implicit)', () => {
    const ws = [wheel({ omega: 5, k: 1e6, share: 1 })]
    const st = newDrivelineState(50)
    for (let i = 0; i < 100; i++) {
      ws[0]!.fx = 1e6 * (ws[0]!.omega * 0.3 - 0) / 0.3 / 0.3 // restoring force toward ω=0
      solveDriveline({ h, engineTorque: 0, engineInertia: 0.2, ratio: 0, clutchCapacity: 0 }, ws, [], st)
      expect(Number.isFinite(ws[0]!.omega)).toBe(true)
    }
    expect(Math.abs(ws[0]!.omega)).toBeLessThan(5)
  })
})

const strut: StrutSpec = {
    spring: 40000,
    damperBump: 2000,
    damperRebound: 3000,
    designLength: 0.4,
    restLength: preloadedRestLength(0.4, 3000, 40000),
    compressionTravel: 0.1,
    droopTravel: 0.08,
    bumpStopRate: 400000,
}
const strutAt = (l: number): number => strutForce(strut, l, 0)

describe('suspension', () => {
  const s = strut
  it('holds the static load at design length', () => {
    expect(strutForce(s, 0.4, 0)).toBeCloseTo(3000)
  })
  it('damps compression and rebound differently', () => {
    expect(strutForce(s, 0.4, -1) - 3000).toBeCloseTo(2000)
    expect(strutForce(s, 0.4, 1) - 3000).toBeCloseTo(-3000)
  })
  it('bump stop is progressive, droop limiter pulls back', () => {
    const at = strutAt
    expect(at(0.29) - at(0.3)).toBeGreaterThan(40000 * 0.01 * 5)
    expect(at(0.5)).toBeLessThan(0)
  })
  it('anti-roll bar resists the difference only', () => {
    expect(antiRollForce(10000, 0.05, 0.05)).toBe(0)
    expect(antiRollForce(10000, 0.05, 0)).toBe(500)
  })
})

describe('steering', () => {
  it('inner wheel turns tighter (Ackermann)', () => {
    const d = 0.3
    const left = ackermannAngle(d, 2.7, 0.78) // left turn: left wheel is inner
    const right = ackermannAngle(d, 2.7, -0.78)
    expect(left).toBeGreaterThan(d)
    expect(right).toBeLessThan(d)
  })
  it('symmetric for right turns and straight ahead', () => {
    expect(ackermannAngle(-0.3, 2.7, -0.78)).toBeCloseTo(-ackermannAngle(0.3, 2.7, 0.78))
    expect(wheelSteerAngle(0, 2.7, 0.78, 1, 0)).toBe(0)
  })
  it('toe-in points both wheels toward the centreline', () => {
    expect(wheelSteerAngle(0, 2.7, 0.78, 1, 0.01)).toBeLessThan(0) // left wheel → right
    expect(wheelSteerAngle(0, 2.7, -0.78, 1, 0.01)).toBeGreaterThan(0)
  })
})

describe('tyre (extended)', () => {
  const t = sedan.tyre
  const base: TyreInput = { slipRatio: 0, slipAngle: 0.1, load: 4000, nominalLoad: 4000, surfaceMu: 1, camber: 0, pressure: t.pressure }
  const out = { fx: 0, fy: 0 }
  const peakFy = (i: TyreInput): number => {
    let m = 0
    for (let a = 0; a < 0.5; a += 0.005) m = Math.max(m, Math.abs(tyreForces2(t, { ...i, slipAngle: a }, out).fy))
    return m
  }
  it('load sensitivity: μ drops as load rises', () => {
    expect(peakFy({ ...base, load: 8000 }) / 8000).toBeLessThan(peakFy(base) / 4000)
  })
  it('lateral force opposes lateral slip', () => {
    expect(tyreForces2(t, base, out).fy).toBeLessThan(0)
  })
  it('camber leans the force toward the lean side', () => {
    const fy0 = tyreForces2(t, { ...base, slipAngle: 0 }, out).fy
    expect(tyreForces2(t, { ...base, slipAngle: 0, camber: 0.03 }, out).fy).toBeGreaterThan(fy0)
  })
  it('wrong pressure costs grip', () => {
    expect(peakFy({ ...base, pressure: t.pressure * 1.5 })).toBeLessThan(peakFy(base))
  })
  it('slips stay finite at standstill', () => {
    expect(slipRatio(0, 0.3, 0)).toBe(0)
    expect(Math.abs(slipAngle(0, 0.01))).toBeLessThan(0.01)
  })
})
