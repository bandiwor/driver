/** Deterministic PRNG (mulberry32). Same seed -> same sequence on every platform. */
export class Rng {
  #s: number
  constructor(seed = 0x9e3779b9) {
    this.#s = seed >>> 0
  }
  reseed(seed: number): void {
    this.#s = seed >>> 0
  }
  next(): number {
    let t = (this.#s = (this.#s + 0x6d2b79f5) >>> 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next()
  }
  /** Approx. gaussian, mean 0, sd 1. */
  gauss(): number {
    return this.next() + this.next() + this.next() + this.next() - 2
  }
}
