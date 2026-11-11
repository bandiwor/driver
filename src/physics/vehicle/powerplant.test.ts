import { describe, expect, it } from 'vitest'
import {
  BEST_POWER_LAMBDA,
  EnginePipeline,
  mixtureEfficiency,
  registerEngineModule,
  timingEfficiency,
  type CombustionState,
  type EngineModule,
  type EngineModuleDef,
} from './powerplant.ts'
import { sample } from './curve.ts'
import { sedan } from '../../vehicles/sedan.ts'

// ── a toy "nitrous" module, declared exactly like a mod would ──
interface NitrousDef {
  kind: 'nitrous'
  id?: string
  /** Extra charge fraction while the pedal is floored. */
  shot: number
}
declare module './powerplant.ts' {
  interface EngineModuleKinds {
    nitrous: NitrousDef
  }
}
class Nitrous implements EngineModule {
  readonly kind = 'nitrous'
  readonly stage = 'intake'
  readonly id: string
  enabled = true
  shot: number
  constructor(d: NitrousDef) {
    this.id = d.id ?? 'nitrous'
    this.shot = d.shot
  }
  pre(c: CombustionState): void {
    if (c.pedal > 0.95) c.boost += this.shot
  }
  set(key: string, v: number): boolean {
    if (key !== 'shot') return false
    this.shot = v
    return true
  }
  reset(): void {}
}

const spec = sedan.engine
const DT = 1 / 1000
const make = (over: Partial<Record<string, number>> = {}): EnginePipeline => {
  const p = new EnginePipeline(sedan.powerplant)
  for (const [k, v] of Object.entries(over)) if (v !== undefined) p.setParam(k, v)
  return p
}
/** Run at fixed rpm/pedal for `s` seconds; returns last torque. */
const hold = (p: EnginePipeline, rpm: number, pedal: number, s: number): number => {
  let t = 0
  for (let i = 0; i < s / DT; i++) t = p.run(spec, rpm, pedal, pedal, true, DT)
  return t
}
/** Rev to 6000 at WOT, lift for 1.5 s, repeated; returns afterfire count. */
const popCycle = (p: EnginePipeline, cycles = 4): number => {
  for (let c = 0; c < cycles; c++) {
    hold(p, 6000, 1, 1.5)
    hold(p, 5000, 0, 1.5)
  }
  return p.c.afterfires
}

/** Seconds of WOT at 4500 rpm until 0.7 bar, for a given turbo size. */
const timeToBoost = (size: number): number => {
  const p = make({ 'turbo.enabled': 1, 'turbo.boost': 0.8, 'turbo.size': size })
  let s = 0
  while (p.c.boost < 0.7 && s < 20) {
    hold(p, 4500, 1, 0.05)
    s += 0.05
  }
  return s
}

describe('mixture & timing curves', () => {
  it('best power at λ≈0.88; lean falls faster than rich', () => {
    expect(mixtureEfficiency(BEST_POWER_LAMBDA)).toBe(1)
    expect(mixtureEfficiency(1.0)).toBeGreaterThan(0.9)
    expect(mixtureEfficiency(BEST_POWER_LAMBDA + 0.2)).toBeLessThan(mixtureEfficiency(BEST_POWER_LAMBDA - 0.2))
  })
  it('retard and over-advance both cost torque', () => {
    expect(timingEfficiency(0)).toBe(1)
    expect(timingEfficiency(-15)).toBeLessThan(0.7)
    expect(timingEfficiency(8)).toBeLessThan(timingEfficiency(0))
  })
})

describe('EnginePipeline', () => {
  it('stock NA engine reproduces the torque map at WOT', () => {
    const p = make()
    expect(hold(p, 4800, 1, 0.5)).toBeCloseTo(sample(spec.torqueCurve, 4800), 3)
  })

  it('manifold fills with a lag (no instant torque)', () => {
    const p = make()
    hold(p, 3000, 0, 0.5)
    const first = p.run(spec, 3000, 1, 1, true, DT)
    expect(first).toBeLessThan(sample(spec.torqueCurve, 3000) * 0.2)
  })

  it('turbo: lag, then boost up to the wastegate, more torque', () => {
    const p = make({ 'turbo.enabled': 1, 'turbo.boost': 1 })
    const early = hold(p, 4500, 1, 0.15)
    const late = hold(p, 4500, 1, 4)
    expect(p.c.boost).toBeGreaterThan(0.85)
    expect(p.c.boost).toBeLessThanOrEqual(1 + 1e-9)
    expect(late).toBeGreaterThan(early * 1.5)
    expect(late).toBeGreaterThan(sample(spec.torqueCurve, 4500) * 1.8)
  })

  it('bigger turbo = more lag', () => {
    expect(timeToBoost(2)).toBeGreaterThan(timeToBoost(0.8))
  })

  it('throttle lift with boost triggers a blow-off event', () => {
    const p = make({ 'turbo.enabled': 1 })
    hold(p, 5000, 1, 3)
    const before = p.c.blowOffs
    hold(p, 5000, 0, 0.2)
    expect(p.c.blowOffs).toBe(before + 1)
  })

  it('rich mixture and burble fuelling pop more than a lean, clean tune', () => {
    const clean = popCycle(make({ 'fuel.lambda': 1.0, 'fuel.overrun': 0 }))
    const rich = popCycle(make({ 'fuel.lambda': 0.72, 'fuel.overrun': 0 }))
    const burble = popCycle(make({ 'fuel.lambda': 1.0, 'fuel.overrun': 1 }))
    expect(rich).toBeGreaterThan(clean)
    expect(burble).toBeGreaterThan(clean)
  })

  it('anti-lag keeps the turbo spinning off-throttle (and pops)', () => {
    const off = make({ 'turbo.enabled': 1 })
    const on = make({ 'turbo.enabled': 1, 'turbo.antiLag': 1 })
    for (const p of [off, on]) {
      hold(p, 6000, 1, 3)
      hold(p, 5000, 0, 1.5)
    }
    expect(on.c.turboSpin).toBeGreaterThan(off.c.turboSpin)
    expect(on.c.afterfires).toBeGreaterThan(off.c.afterfires)
  })

  it('lean runs hotter, rich makes soot', () => {
    const lean = make({ 'fuel.lambda': 1.2 })
    const rich = make({ 'fuel.lambda': 0.7 })
    hold(lean, 5000, 1, 3)
    hold(rich, 5000, 1, 3)
    expect(lean.c.egt).toBeGreaterThan(rich.c.egt)
    expect(rich.c.soot).toBeGreaterThan(0.4)
    expect(lean.c.soot).toBe(0)
  })

  it('is deterministic and reset() restores the start state (keeps event counters)', () => {
    const a = make({ 'fuel.overrun': 1 })
    const b = make({ 'fuel.overrun': 1 })
    expect(popCycle(a)).toBe(popCycle(b))
    const n = a.c.afterfires
    a.reset()
    expect(a.c.egt).toBe(300)
    expect(a.c.afterfires).toBe(n)
  })

  it('routes `<module>.<key>` params and rejects unknown ones', () => {
    const p = make()
    expect(p.setParam('turbo.enabled', 1)).toBe(true)
    expect(p.module('turbo')?.enabled).toBe(true)
    expect(p.setParam('turbo.nope', 1)).toBe(false)
    expect(p.setParam('nope.x', 1)).toBe(false)
  })

  it('new module kinds plug in through the registry (extensibility)', () => {
    registerEngineModule('nitrous', (d) => new Nitrous(d))
    const defs: EngineModuleDef[] = [...sedan.powerplant, { kind: 'nitrous', shot: 0.5 }]
    const withN2O = new EnginePipeline(defs)
    const stock = make()
    expect(hold(withN2O, 4000, 1, 0.5)).toBeCloseTo(hold(stock, 4000, 1, 0.5) * 1.5, 3)
    expect(withN2O.setParam('nitrous.shot', 0)).toBe(true)
    expect(hold(withN2O, 4000, 1, 0.5)).toBeCloseTo(hold(stock, 4000, 1, 0.5), 3)
    expect(() => registerEngineModule('nitrous', (d) => new Nitrous(d))).toThrow(/already/)
  })
})
