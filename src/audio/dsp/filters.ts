/** Small allocation-free DSP primitives shared by synth voices. */
export class OnePole {
  #z = 0
  #a = 0
  constructor(
    readonly sampleRate: number,
    cutoffHz: number,
  ) {
    this.setCutoff(cutoffHz)
  }
  setCutoff(hz: number): void {
    this.#a = 1 - Math.exp((-2 * Math.PI * hz) / this.sampleRate)
  }
  lp(x: number): number {
    this.#z += this.#a * (x - this.#z)
    return this.#z
  }
  hp(x: number): number {
    return x - this.lp(x)
  }
}

/** RBJ biquad band-pass (constant peak gain). */
export class BandPass {
  #b0 = 0
  #b2 = 0
  #a1 = 0
  #a2 = 0
  #x1 = 0
  #x2 = 0
  #y1 = 0
  #y2 = 0
  constructor(
    readonly sampleRate: number,
    hz: number,
    q: number,
  ) {
    this.set(hz, q)
  }
  set(hz: number, q: number): void {
    const w = (2 * Math.PI * Math.min(hz, this.sampleRate * 0.45)) / this.sampleRate
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    this.#b0 = alpha / a0
    this.#b2 = -alpha / a0
    this.#a1 = (-2 * Math.cos(w)) / a0
    this.#a2 = (1 - alpha) / a0
  }
  process(x: number): number {
    const y = this.#b0 * x + this.#b2 * this.#x2 - this.#a1 * this.#y1 - this.#a2 * this.#y2
    this.#x2 = this.#x1
    this.#x1 = x
    this.#y2 = this.#y1
    this.#y1 = y
    return y
  }
}

/** Fast deterministic white noise in [-1, 1]. */
export class Noise {
  #s: number
  constructor(seed = 22222) {
    this.#s = seed >>> 0 || 1
  }
  next(): number {
    let x = this.#s
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.#s = x >>> 0
    return this.#s / 2147483648 - 1
  }
}

export const softClip = (x: number): number => (x > 1 ? 1 : x < -1 ? -1 : x * (1.5 - 0.5 * x * x))
