/**
 * Engine combustion pipeline: a chain of pluggable modules, ordered by stage,
 * that turns pedal/rpm into combustion torque and exhaust conditions.
 *
 *   intake    throttle body → manifold charge (+ turbo boost)
 *   fuel      mixture λ → burn efficiency, unburnt fuel, overrun fuel
 *   ignition  timing → torque factor ↔ heat into the exhaust
 *   (combustion: torque = torqueCurve(rpm) · charge · efficiency · timing)
 *   exhaust   gas temperature, unburnt-fuel store → afterfire pops, smoke
 *
 * Modules are created from data (`EngineModuleDef`) through a registry, so a
 * new component (supercharger, nitrous, …) is a new module + `registerEngineModule`
 * without touching the core. Tuning params `<moduleId>.<key>` are routed to
 * `module.set(key, value)` automatically. Allocation-free per step; uses a
 * deterministic RNG so simulations are reproducible.
 */
import { clamp, smoothstep } from '../../core/math/scalar.ts'
import { Rng } from '../../core/rng.ts'
import { sample } from './curve.ts'
import type { EngineSpec } from './engine.ts'

/** Per-step working state shared by all modules (one instance, reused). */
export interface CombustionState {
  // inputs
  rpm: number
  /** Effective throttle 0..1 (after idle control / limiter). */
  throttle: number
  /** Driver pedal 0..1 (for overrun detection). */
  pedal: number
  running: boolean
  dt: number
  // intake
  /** Manifold charge relative to NA wide-open (1 = atmospheric WOT). */
  charge: number
  /** Turbo boost, bar gauge. */
  boost: number
  /** Turbo shaft speed 0..1 (audio / HUD). */
  turboSpin: number
  // fuel
  /** Air–fuel equivalence ratio (λ < 1 = rich). */
  lambda: number
  /** Burn efficiency from mixture, 1 at best-power mixture. */
  mixtureEfficiency: number
  /** Fuel injected with the throttle closed (burble / anti-lag), 0..1. */
  overrunFuel: number
  /** Overrun = pedal released with the engine well above idle (set by the pipeline). */
  overrun: boolean
  /** Fuel flow relative to NA WOT at redline (for exhaust energy). */
  fuelFlow: number
  // ignition
  /** Spark timing offset from optimal, degrees (− = retard). */
  timing: number
  timingEfficiency: number
  // combustion result
  torque: number
  // exhaust
  /** Energy into the exhaust this step, relative (drives turbo, EGT). */
  exhaustEnergy: number
  /** Unburnt fuel produced this step (relative mass / s). */
  unburntRate: number
  /** Exhaust gas temperature, °C. */
  egt: number
  /** Unburnt fuel stored in the hot exhaust, relative. */
  unburnt: number
  /** Visible smoke from the tailpipe 0..1 and its darkness 0..1. */
  smoke: number
  soot: number
  // event counters (monotonic; consumers diff them)
  afterfires: number
  lastAfterfire: number
  blowOffs: number
}

export type EngineStage = 'intake' | 'fuel' | 'ignition' | 'exhaust'
const STAGE_ORDER: readonly EngineStage[] = ['intake', 'fuel', 'ignition', 'exhaust']

export interface EngineModule {
  readonly id: string
  readonly kind: string
  readonly stage: EngineStage
  enabled: boolean
  /** Before combustion torque is computed (intake/fuel/ignition) … */
  pre?(c: CombustionState, spec: EngineSpec, rng: Rng): void
  /** … and after (exhaust; turbo spool uses the exhaust energy). */
  post?(c: CombustionState, spec: EngineSpec, rng: Rng): void
  /** Tuning hook: `<id>.<key>` params land here. Returns false if unknown. */
  set(key: string, value: number): boolean
  reset(): void
}

// ─── module definitions (data) ─────────────────────────────────────────

export interface FuelModuleDef {
  kind: 'fuel'
  id?: string
  lambda: number
  /** Overrun ("burble") fuelling 0..1. */
  overrun: number
}
export interface IgnitionModuleDef {
  kind: 'ignition'
  id?: string
  timing: number
}
export interface ExhaustModuleDef {
  kind: 'exhaust'
  id?: string
  /** How readily stored fuel ignites (0..2, 1 = typical). */
  popSensitivity: number
}
export interface TurboModuleDef {
  kind: 'turbo'
  id?: string
  enabled: boolean
  /** Wastegate target boost, bar. */
  boost: number
  /** Turbo size: more potential boost and more lag (0.5..2). */
  size: number
  /** Blow-off valve fitted (vents on lift; else compressor flutter). */
  blowOff: boolean
  /** Anti-lag: fuel + retard on overrun keeps the turbo spinning (lots of pops). */
  antiLag: boolean
}
/**
 * Module kind → definition type. Extensible by declaration merging:
 *   declare module '…/powerplant.ts' {
 *     interface EngineModuleKinds { nitrous: NitrousDef }
 *   }
 *   registerEngineModule('nitrous', (d) => new Nitrous(d))
 */
export interface EngineModuleKinds {
  fuel: FuelModuleDef
  ignition: IgnitionModuleDef
  exhaust: ExhaustModuleDef
  turbo: TurboModuleDef
}
export type EngineModuleDef = EngineModuleKinds[keyof EngineModuleKinds]

type AnyFactory = (def: EngineModuleDef) => EngineModule
const registry = new Map<string, AnyFactory>()

/** Register a module kind (extensibility point for mods / new components). */
export function registerEngineModule<K extends keyof EngineModuleKinds>(
  kind: K,
  factory: (def: EngineModuleKinds[K]) => EngineModule,
): void {
  if (registry.has(kind)) throw new Error(`Engine module "${kind}" already registered`)
  // The registry is keyed by `kind`, so a def reaching this factory always has kind K.
  registry.set(kind, factory as AnyFactory)
}

export function createEngineModule(def: EngineModuleDef): EngineModule {
  const f = registry.get(def.kind)
  if (!f) throw new Error(`Unknown engine module "${def.kind}"`)
  return f(def)
}

// ─── pipeline ──────────────────────────────────────────────────────────

/** Best-power mixture (λ); efficiency is normalised to 1 here. */
export const BEST_POWER_LAMBDA = 0.88

/** Burn efficiency vs λ: gentle fall-off rich, steeper lean. */
export const mixtureEfficiency = (lambda: number): number => {
  const d = lambda - BEST_POWER_LAMBDA
  const w = d < 0 ? 0.55 : 0.45
  return Math.exp(-(d / w) * (d / w))
}

/** Torque factor vs timing offset (deg): retard loses torque, over-advance knocks. */
export const timingEfficiency = (timing: number): number =>
  timing <= 0 ? Math.max(0.2, 1 - 0.0022 * timing * timing) : Math.max(0.5, 1 - 0.006 * timing * timing)

export const newCombustionState = (): CombustionState => ({
  rpm: 0,
  throttle: 0,
  pedal: 0,
  running: true,
  dt: 0,
  charge: 0,
  boost: 0,
  turboSpin: 0,
  lambda: BEST_POWER_LAMBDA,
  mixtureEfficiency: 1,
  overrunFuel: 0,
  overrun: false,
  fuelFlow: 0,
  timing: 0,
  timingEfficiency: 1,
  torque: 0,
  exhaustEnergy: 0,
  unburntRate: 0,
  egt: 300,
  unburnt: 0,
  smoke: 0,
  soot: 0,
  afterfires: 0,
  lastAfterfire: 0,
  blowOffs: 0,
})

/** Manifold filling time constant at idle, s (scales with 1/rpm). */
const MANIFOLD_TAU = 0.06

export class EnginePipeline {
  readonly modules: readonly EngineModule[]
  readonly c: CombustionState = newCombustionState()
  readonly #byId: ReadonlyMap<string, EngineModule>
  readonly #rng: Rng
  readonly #seed: number

  constructor(defs: readonly EngineModuleDef[], seed = 1337) {
    const mods = defs.map(createEngineModule)
    mods.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
    const ids = new Map<string, EngineModule>()
    for (const m of mods) {
      if (ids.has(m.id)) throw new Error(`Duplicate engine module id "${m.id}"`)
      ids.set(m.id, m)
    }
    this.modules = mods
    this.#byId = ids
    this.#seed = seed
    this.#rng = new Rng(seed)
  }

  module(id: string): EngineModule | undefined {
    return this.#byId.get(id)
  }

  /** Route a tuning param `<moduleId>.<key>`; returns true if consumed. */
  setParam(paramId: string, value: number): boolean {
    const dot = paramId.indexOf('.')
    if (dot < 0) return false
    const m = this.#byId.get(paramId.slice(0, dot))
    if (!m) return false
    const key = paramId.slice(dot + 1)
    if (key === 'enabled') {
      m.enabled = value >= 0.5
      if (!m.enabled) m.reset()
      return true
    }
    return m.set(key, value)
  }

  /**
   * One step. Returns combustion torque (Nm, before friction/pumping losses).
   * When not running, modules still evolve (turbo spins down, exhaust cools).
   */
  run(spec: EngineSpec, rpm: number, throttle: number, pedal: number, running: boolean, dt: number): number {
    const c = this.c
    c.rpm = rpm
    c.throttle = throttle
    c.pedal = pedal
    c.running = running
    c.dt = dt
    // Base intake: manifold fills toward the throttle opening (faster at high rpm).
    const tau = (MANIFOLD_TAU * spec.idleRpm) / Math.max(rpm, spec.idleRpm * 0.5)
    const target = running ? throttle : 0
    c.charge += (target - c.charge) * Math.min(1, dt / tau)
    c.boost = 0
    c.overrunFuel = 0
    c.overrun = running && pedal < 0.05 && rpm > spec.idleRpm * 1.5
    c.timing = 0
    c.lambda = BEST_POWER_LAMBDA
    for (const m of this.modules) if (m.enabled) m.pre?.(c, spec, this.#rng)
    c.mixtureEfficiency = mixtureEfficiency(c.lambda)
    c.timingEfficiency = timingEfficiency(c.timing)
    const airCharge = c.charge * (1 + c.boost)
    const rpmFrac = rpm / spec.redlineRpm
    c.torque = running ? sample(spec.torqueCurve, rpm) * airCharge * c.mixtureEfficiency * c.timingEfficiency : 0
    // Fuel flow ∝ air / λ, plus overrun fuel with the throttle shut.
    const overrun = c.overrun ? c.overrunFuel * 0.35 : 0
    c.fuelFlow = running ? (airCharge / Math.max(0.5, c.lambda)) * rpmFrac + overrun * rpmFrac : 0
    // Energy that does not become torque goes down the pipe (retard, rich, overrun burn).
    const wasted = (1 - c.timingEfficiency) * 1.6 + Math.max(0, 1 - c.mixtureEfficiency) * 0.4
    c.exhaustEnergy = running ? airCharge * rpmFrac * (1 + wasted) + overrun * rpmFrac * 1.5 : 0
    // Unburnt fuel: rich mixture, overrun fuelling, heavy retard.
    c.unburntRate = running
      ? airCharge * rpmFrac * Math.max(0, 0.97 - c.lambda) * 2.2 + overrun * rpmFrac * 2.5 + Math.max(0, -c.timing - 8) * 0.004 * rpmFrac
      : 0
    for (const m of this.modules) if (m.enabled) m.post?.(c, spec, this.#rng)
    return c.torque
  }

  reset(): void {
    const keep = { afterfires: this.c.afterfires, blowOffs: this.c.blowOffs }
    Object.assign(this.c, newCombustionState(), keep)
    for (const m of this.modules) m.reset()
    this.#rng.reseed(this.#seed)
  }
}

// ─── built-in modules ─────────────────────────────────────────────────

/** Mixture control (λ target) + overrun fuelling ("burble" tune). */
class FuelModule implements EngineModule {
  readonly kind = 'fuel'
  readonly stage = 'fuel'
  enabled = true
  readonly id: string
  lambda: number
  overrun: number
  constructor(d: FuelModuleDef) {
    this.id = d.id ?? 'fuel'
    this.lambda = d.lambda
    this.overrun = d.overrun
  }
  pre(c: CombustionState): void {
    c.lambda = this.lambda
    c.overrunFuel = Math.max(c.overrunFuel, this.overrun)
  }
  set(key: string, v: number): boolean {
    if (key === 'lambda') this.lambda = clamp(v, 0.5, 1.5)
    else if (key === 'overrun') this.overrun = clamp(v, 0, 1)
    else return false
    return true
  }
  reset(): void {}
}

/** Spark timing offset. Retard on overrun when burble fuelling is on (more pops). */
class IgnitionModule implements EngineModule {
  readonly kind = 'ignition'
  readonly stage = 'ignition'
  enabled = true
  readonly id: string
  timing: number
  constructor(d: IgnitionModuleDef) {
    this.id = d.id ?? 'ignition'
    this.timing = d.timing
  }
  pre(c: CombustionState): void {
    c.timing += this.timing
    if (c.overrun && c.overrunFuel > 0) c.timing -= 18 * c.overrunFuel
  }
  set(key: string, v: number): boolean {
    if (key !== 'timing') return false
    this.timing = clamp(v, -30, 15)
    return true
  }
  reset(): void {}
}

/** Exhaust gas temperature, stored unburnt fuel, afterfire pops, smoke. */
class ExhaustModule implements EngineModule {
  readonly kind = 'exhaust'
  readonly stage = 'exhaust'
  enabled = true
  readonly id: string
  popSensitivity: number
  constructor(d: ExhaustModuleDef) {
    this.id = d.id ?? 'exhaust'
    this.popSensitivity = d.popSensitivity
  }
  post(c: CombustionState, _spec: EngineSpec, rng: Rng): void {
    const dt = c.dt
    // EGT: ambient-ish when stopped, rises with exhaust energy (retard/lean run hot).
    const lean = Math.max(0, c.lambda - 1) * 2
    const target = c.running ? 320 + 620 * Math.min(1.6, c.exhaustEnergy) * (1 + lean) : 60
    c.egt += (target - c.egt) * Math.min(1, dt / 1.2)
    // Unburnt fuel store: fed by the engine, scavenged out over time.
    c.unburnt += (c.unburntRate - c.unburnt * 0.9) * dt
    if (c.unburnt < 0) c.unburnt = 0
    // Ignition in the pipe needs heat + oxygen; pops are likeliest on lift-off
    // (fresh air pulled through a hot, fuel-wet exhaust).
    const heat = smoothstep(420, 780, c.egt)
    const lift = c.pedal < 0.2 ? 1 : 0.25
    const rate = 55 * c.unburnt * heat * lift * this.popSensitivity // pops / s
    if (c.running || c.rpm > 300) {
      if (rng.next() < rate * dt) {
        const strength = clamp(c.unburnt * 2.2 + 0.25 * heat, 0.15, 1)
        c.afterfires++
        c.lastAfterfire = strength
        c.unburnt *= 0.55
      }
    }
    // Tailpipe smoke: rich → sooty and visible; lean/stoich → light vapour under load.
    const rich = Math.max(0, 0.9 - c.lambda)
    c.soot = clamp(rich * 3.2, 0, 1)
    c.smoke = clamp(c.fuelFlow * (0.08 + rich * 2.5), 0, 1)
  }
  set(key: string, v: number): boolean {
    if (key !== 'pops') return false
    this.popSensitivity = clamp(v, 0, 3)
    return true
  }
  reset(): void {}
}

/**
 * Exhaust-driven turbocharger. Shaft speed integrates exhaust energy against
 * aero drag; boost ∝ spin² up to the wastegate target. Size trades boost
 * potential for lag (inertia ∝ size²). Throttle lift with boost → blow-off.
 */
class TurboModule implements EngineModule {
  readonly kind = 'turbo'
  readonly stage = 'intake'
  readonly id: string
  enabled: boolean
  boostTarget: number
  size: number
  blowOff: boolean
  antiLag: boolean
  spin = 0
  #prevPedal = 0
  #liftTimer = 0
  constructor(d: TurboModuleDef) {
    this.id = d.id ?? 'turbo'
    this.enabled = d.enabled
    this.boostTarget = d.boost
    this.size = d.size
    this.blowOff = d.blowOff
    this.antiLag = d.antiLag
  }
  get maxBoost(): number {
    return 1.4 * this.size
  }
  pre(c: CombustionState, spec: EngineSpec): void {
    const raw = this.maxBoost * this.spin * this.spin
    // Boost only develops against an open throttle.
    c.boost = Math.min(raw, this.boostTarget) * smoothstep(0.05, 0.6, c.charge)
    c.turboSpin = this.spin
    if (this.antiLag && c.overrun && c.rpm > spec.idleRpm * 2) {
      c.overrunFuel = Math.max(c.overrunFuel, 0.9)
      c.timing -= 12
    }
  }
  post(c: CombustionState): void {
    const dt = c.dt
    const inertia = 0.35 * this.size * this.size
    const raw = this.maxBoost * this.spin * this.spin
    // Wastegate bypasses exhaust once the target is reached.
    const gate = raw > this.boostTarget ? 0.15 : 1
    const drive = c.exhaustEnergy * 1.6 * gate
    const drag = 0.25 + 0.9 * this.spin * this.spin
    this.spin = clamp(this.spin + ((drive - drag * this.spin) / inertia) * dt, 0, 1)
    // Lift-off detection: pedal dropped sharply with boost in the system.
    const dropped = this.#prevPedal - c.pedal
    this.#liftTimer = Math.max(0, this.#liftTimer - dt)
    if (dropped > 0.45 && c.boost > 0.25 && this.#liftTimer === 0) {
      c.blowOffs++
      this.#liftTimer = 0.4
      // A BOV vents the charge and keeps the wheel spinning; without one the
      // compressor surges and the shaft is braked.
      this.spin *= this.blowOff ? 0.92 : 0.75
    }
    this.#prevPedal = c.pedal
    c.turboSpin = this.spin
  }
  set(key: string, v: number): boolean {
    switch (key) {
      case 'boost':
        this.boostTarget = clamp(v, 0, 3)
        return true
      case 'size':
        this.size = clamp(v, 0.3, 3)
        return true
      case 'blowOff':
        this.blowOff = v >= 0.5
        return true
      case 'antiLag':
        this.antiLag = v >= 0.5
        return true
    }
    return false
  }
  reset(): void {
    this.spin = 0
    this.#prevPedal = 0
    this.#liftTimer = 0
  }
}

registerEngineModule('fuel', (d) => new FuelModule(d))
registerEngineModule('ignition', (d) => new IgnitionModule(d))
registerEngineModule('exhaust', (d) => new ExhaustModule(d))
registerEngineModule('turbo', (d) => new TurboModule(d))
