/**
 * Vehicle visual effects driven purely by simulation state (works the same
 * with inline or worker physics — it only reads the synced vehicle +
 * telemetry):
 *   - tyre smoke: per wheel, rate ∝ contact-patch slip speed × load
 *   - tailpipe smoke: amount and darkness from the mixture (telemetry.smoke/soot)
 *   - afterfire: monotonic pop counter → flame burst + smoke puff + light flash
 * Emission is time-based with fractional carry, so it is frame-rate independent.
 * Mapping functions are pure and exported for tests.
 */
import * as THREE from 'three'
import { clamp, smoothstep } from '../core/math/scalar.ts'
import { localToWorld } from '../physics/softbody/frame.ts'
import type { Vehicle, VehicleTelemetry } from '../vehicles/runtime.ts'
import { ParticlePool, newEmit, type EmitParams } from './particles.ts'

/** Tyre smoke intensity 0..1 from slip speed (m/s) and load relative to static. */
export const tyreSmokeIntensity = (slipSpeed: number, load: number, nominalLoad: number): number =>
  smoothstep(2.5, 11, slipSpeed) * clamp(load / Math.max(1, nominalLoad), 0, 1.6)

/** Exhaust smoke colour (linear grey 0..1) from soot 0..1: white vapour → black. */
export const exhaustGrey = (soot: number): number => 0.82 - 0.72 * clamp(soot, 0, 1)

export interface EffectsStats {
  smoke: number
  fire: number
}

export class VehicleEffects {
  readonly group = new THREE.Group()
  readonly smoke: ParticlePool
  readonly fire: ParticlePool
  readonly #vehicle: Vehicle
  readonly #tel: VehicleTelemetry
  readonly #flash: THREE.PointLight
  readonly #tyreCarry: Float64Array
  readonly #exhaustCarry: Float64Array
  readonly #e: EmitParams = newEmit()
  readonly #tip: [number, number, number] = [0, 0, 0]
  readonly #tipsLocal: [number, number, number][]
  #lastPops = -1
  #flashLevel = 0

  constructor(vehicle: Vehicle, telemetry: VehicleTelemetry, opts: { smokeCapacity?: number; fireCapacity?: number } = {}) {
    this.#vehicle = vehicle
    this.#tel = telemetry
    this.smoke = new ParticlePool(opts.smokeCapacity ?? 2500, 'normal', 11)
    this.fire = new ParticlePool(opts.fireCapacity ?? 600, 'additive', 23)
    this.#flash = new THREE.PointLight(0xff8a2a, 0, 6, 2)
    this.group.add(this.smoke.mesh, this.fire.mesh, this.#flash)
    this.#tyreCarry = new Float64Array(vehicle.wheels.length)
    this.#tipsLocal = vehicle.def.exhausts.map((p) => vehicle.frameLocal(p))
    this.#exhaustCarry = new Float64Array(this.#tipsLocal.length)
  }

  get stats(): EffectsStats {
    return { smoke: this.smoke.state.live, fire: this.fire.state.live }
  }

  update(dt: number): void {
    if (dt <= 0) return
    this.#tyres(dt)
    this.#exhaust(dt)
    this.smoke.update(dt)
    this.fire.update(dt)
    this.#flashLevel = Math.max(0, this.#flashLevel - dt * 18)
    this.#flash.intensity = this.#flashLevel * 40
  }

  clear(): void {
    this.smoke.state.clear()
    this.fire.state.clear()
    this.#lastPops = this.#tel.afterfires
  }

  #tyres(dt: number): void {
    const v = this.#vehicle
    const f = v.frame
    const pos = v.body.pos
    const R = v.def.tyre.radius
    const rng = this.smoke.rng
    const e = this.#e
    const nominal = v.chassis.nominalLoad
    for (let i = 0; i < v.wheels.length; i++) {
      const w = v.wheels[i]!
      const k = tyreSmokeIntensity(w.slipSpeed, w.load, nominal[i]!)
      if (k <= 0.01 || !w.contact) {
        this.#tyreCarry[i] = 0
        continue
      }
      this.#tyreCarry[i] = this.#tyreCarry[i]! + k * 90 * dt
      const h3 = v.vb.wheelNodes[i]! * 3
      // Contact patch ≈ hub − up·R.
      const cx = pos[h3]! - f.ux * R
      const cy = pos[h3 + 1]! - f.uy * R + 0.05
      const cz = pos[h3 + 2]! - f.uz * R
      while (this.#tyreCarry[i]! >= 1) {
        this.#tyreCarry[i] = this.#tyreCarry[i]! - 1
        e.x = cx + rng.range(-0.15, 0.15)
        e.y = cy
        e.z = cz + rng.range(-0.15, 0.15)
        // Smoke is dragged along a little, then lingers.
        e.vx = f.vx * 0.25 + rng.range(-0.8, 0.8)
        e.vy = rng.range(0.3, 1.1)
        e.vz = f.vz * 0.25 + rng.range(-0.8, 0.8)
        e.life = rng.range(2.2, 4.2)
        e.size0 = 0.35
        e.size1 = rng.range(2.2, 3.6)
        const g = rng.range(0.78, 0.9)
        e.r0 = g
        e.g0 = g
        e.b0 = g
        e.r1 = g * 0.95
        e.g1 = g * 0.95
        e.b1 = g * 0.97
        e.alpha = 0.22 + 0.25 * Math.min(1, k)
        e.drag = 1.4
        e.buoyancy = 0.25
        this.smoke.emit(e)
      }
    }
  }

  #exhaust(dt: number): void {
    const v = this.#vehicle
    const t = this.#tel
    const f = v.frame
    const e = this.#e
    const rng = this.smoke.rng
    // Afterfire: diff the monotonic counter (no event is lost between frames).
    if (this.#lastPops < 0) this.#lastPops = t.afterfires
    const pops = Math.min(6, t.afterfires - this.#lastPops)
    this.#lastPops = t.afterfires
    const grey = exhaustGrey(t.soot)
    const rate = 6 + 160 * t.smoke // puffs / s per tip
    for (let k = 0; k < this.#tipsLocal.length; k++) {
      const [lx, ly, lz] = this.#tipsLocal[k]!
      localToWorld(f, lx, ly, lz, this.#tip)
      const [tx, ty, tz] = this.#tip
      // Backwards along the body (−forward).
      const bx = -f.fx
      const by = -f.fy
      const bz = -f.fz
      this.#exhaustCarry[k] = this.#exhaustCarry[k]! + (t.smoke > 0.01 ? rate * dt : 0)
      while (this.#exhaustCarry[k]! >= 1) {
        this.#exhaustCarry[k] = this.#exhaustCarry[k]! - 1
        const spd = rng.range(2, 4)
        e.x = tx
        e.y = ty
        e.z = tz
        e.vx = f.vx * 0.6 + bx * spd + rng.range(-0.3, 0.3)
        e.vy = f.vy * 0.6 + by * spd + rng.range(0, 0.3)
        e.vz = f.vz * 0.6 + bz * spd + rng.range(-0.3, 0.3)
        e.life = rng.range(0.8, 1.6) * (0.6 + t.soot)
        e.size0 = 0.08
        e.size1 = rng.range(0.6, 1.1) * (0.7 + t.soot)
        e.r0 = grey
        e.g0 = grey
        e.b0 = grey
        e.r1 = grey * 0.9
        e.g1 = grey * 0.9
        e.b1 = grey * 0.9
        e.alpha = clamp(0.06 + 0.45 * t.smoke * (0.4 + t.soot), 0, 0.6)
        e.drag = 2.2
        e.buoyancy = 0.4
        this.smoke.emit(e)
      }
      for (let p = 0; p < pops; p++) this.#afterfire(tx, ty, tz, bx, by, bz, t.afterfireStrength)
      if (pops > 0) {
        this.#flash.position.set(tx + bx * 0.3, ty + 0.05, tz + bz * 0.3)
        this.#flashLevel = Math.max(this.#flashLevel, 0.5 + 0.5 * t.afterfireStrength)
      }
    }
  }

  #afterfire(tx: number, ty: number, tz: number, bx: number, by: number, bz: number, strength: number): void {
    const f = this.#vehicle.frame
    const rng = this.fire.rng
    const e = this.#e
    const n = 8 + Math.round(14 * strength)
    for (let i = 0; i < n; i++) {
      const spd = rng.range(5, 11) * (0.6 + 0.6 * strength)
      e.x = tx
      e.y = ty
      e.z = tz
      e.vx = f.vx + bx * spd + rng.range(-1.2, 1.2)
      e.vy = f.vy + by * spd + rng.range(-0.5, 1)
      e.vz = f.vz + bz * spd + rng.range(-1.2, 1.2)
      e.life = rng.range(0.05, 0.14) * (0.8 + strength)
      e.size0 = rng.range(0.12, 0.22) * (0.8 + strength)
      e.size1 = e.size0 * 2.2
      // Blue-white core → orange → dark red.
      const core = rng.next() < 0.25
      e.r0 = core ? 0.75 : 1
      e.g0 = core ? 0.8 : 0.62
      e.b0 = core ? 1 : 0.18
      e.r1 = 0.85
      e.g1 = 0.18
      e.b1 = 0.02
      e.alpha = 0.9
      e.drag = 6
      e.buoyancy = 0.8
      this.fire.emit(e)
    }
    // A puff of smoke after the bang.
    const sr = this.smoke.rng
    for (let i = 0; i < 4; i++) {
      e.x = tx + bx * 0.3
      e.y = ty
      e.z = tz + bz * 0.3
      e.vx = f.vx * 0.5 + bx * sr.range(1.5, 3)
      e.vy = sr.range(0.2, 0.7)
      e.vz = f.vz * 0.5 + bz * sr.range(1.5, 3)
      e.life = sr.range(0.7, 1.3)
      e.size0 = 0.2
      e.size1 = 0.9
      e.r0 = 0.35
      e.g0 = 0.33
      e.b0 = 0.32
      e.r1 = 0.5
      e.g1 = 0.5
      e.b1 = 0.5
      e.alpha = 0.35
      e.drag = 2.5
      e.buoyancy = 0.5
      this.smoke.emit(e)
    }
  }

  dispose(): void {
    this.smoke.dispose()
    this.fire.dispose()
    this.group.removeFromParent()
  }
}
