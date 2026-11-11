/**
 * Heightfield terrain: a square grid of heights + a per-vertex surface id.
 * Implements `Ground`, so body nodes and tyres work on slopes and different
 * surfaces with zero special-casing. Sampling is bilinear (height) with the
 * analytic gradient of the bilinear patch (normal); surface properties come
 * from per-surface lookup tables. Allocation-free.
 */
import type { Ground, GroundSample } from '../physics/softbody/ground.ts'
import { surfaces } from './surfaces.ts'

export class Heightfield implements Ground {
  /** Vertices per side. */
  readonly n: number
  readonly cell: number
  readonly size: number
  readonly half: number
  readonly heights: Float32Array
  readonly surface: Uint8Array
  readonly #friction: Float32Array
  readonly #rolling: Float32Array
  readonly #stiffness: Float32Array

  constructor(size: number, cell: number) {
    this.n = Math.round(size / cell) + 1
    this.cell = cell
    this.size = (this.n - 1) * cell
    this.half = this.size / 2
    this.heights = new Float32Array(this.n * this.n)
    this.surface = new Uint8Array(this.n * this.n)
    const s = surfaces()
    this.#friction = Float32Array.from(s, (d) => d.friction)
    this.#rolling = Float32Array.from(s, (d) => d.rolling)
    this.#stiffness = Float32Array.from(s, (d) => d.stiffness)
  }

  /** World x/z of grid vertex (i, j); i along x, j along z. */
  vx(i: number): number {
    return -this.half + i * this.cell
  }
  vz(j: number): number {
    return -this.half + j * this.cell
  }

  index(i: number, j: number): number {
    return j * this.n + i
  }

  heightAt(x: number, z: number): number {
    const n = this.n
    const fx = Math.min(Math.max((x + this.half) / this.cell, 0), n - 1.000001)
    const fz = Math.min(Math.max((z + this.half) / this.cell, 0), n - 1.000001)
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const u = fx - i
    const v = fz - j
    const h = this.heights
    const k = j * n + i
    const h00 = h[k]!
    const h10 = h[k + 1]!
    const h01 = h[k + n]!
    const h11 = h[k + n + 1]!
    return h00 + (h10 - h00) * u + (h01 - h00) * v + (h00 - h10 - h01 + h11) * u * v
  }

  sample(x: number, z: number, out: GroundSample): GroundSample {
    const n = this.n
    const c = this.cell
    const fx = Math.min(Math.max((x + this.half) / c, 0), n - 1.000001)
    const fz = Math.min(Math.max((z + this.half) / c, 0), n - 1.000001)
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const u = fx - i
    const v = fz - j
    const h = this.heights
    const k = j * n + i
    const h00 = h[k]!
    const h10 = h[k + 1]!
    const h01 = h[k + n]!
    const h11 = h[k + n + 1]!
    const cross = h00 - h10 - h01 + h11
    out.height = h00 + (h10 - h00) * u + (h01 - h00) * v + cross * u * v
    // Gradient of the bilinear patch → normal (−hx, 1, −hz).
    const hx = (h10 - h00 + cross * v) / c
    const hz = (h01 - h00 + cross * u) / c
    const inv = 1 / Math.sqrt(hx * hx + 1 + hz * hz)
    out.nx = -hx * inv
    out.ny = inv
    out.nz = -hz * inv
    // Surface of the nearest vertex.
    const s = this.surface[(v < 0.5 ? j : j + 1) * n + (u < 0.5 ? i : i + 1)]!
    out.surface = s
    out.friction = this.#friction[s] ?? 1
    out.rolling = this.#rolling[s] ?? 0
    out.stiffness = this.#stiffness[s] ?? 1
    return out
  }

  /** Visit every vertex within an axis-aligned world rectangle. */
  forEachIn(minX: number, minZ: number, maxX: number, maxZ: number, fn: (k: number, x: number, z: number) => void): void {
    const n = this.n
    const i0 = Math.max(0, Math.floor((minX + this.half) / this.cell))
    const i1 = Math.min(n - 1, Math.ceil((maxX + this.half) / this.cell))
    const j0 = Math.max(0, Math.floor((minZ + this.half) / this.cell))
    const j1 = Math.min(n - 1, Math.ceil((maxZ + this.half) / this.cell))
    for (let j = j0; j <= j1; j++) {
      const z = this.vz(j)
      for (let i = i0; i <= i1; i++) fn(j * n + i, this.vx(i), z)
    }
  }
}
