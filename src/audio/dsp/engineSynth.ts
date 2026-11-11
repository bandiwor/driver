/**
 * Procedural combustion engine voice.
 * Model: crank-angle phase drives N cylinder firing events per 2 revolutions.
 * Each event excites a decaying pulse (combustion "pop"); the pulse train
 * passes through exhaust resonances (band-pass bank) + intake hiss scaled by
 * load, then soft saturation. Pure class — runs identically inside the
 * AudioWorklet and in Node tests (offline render).
 */
import { BandPass, Noise, OnePole, softClip } from './filters.ts'

export interface EngineVoiceParams {
  rpm: number
  load: number // 0..1
  throttle: number // 0..1
}

export interface EngineVoiceSpec {
  cylinders: number
  /** Exhaust resonance centre frequencies, Hz. */
  resonances: readonly number[]
  /** Per-cylinder firing irregularity (0..0.1) — gives character / burble. */
  irregularity: number
  gain: number
}

/** Voice for a vehicle: cylinder count + its exhaust character. */
export const voiceFor = (cylinders: number, sound: { resonances: readonly number[]; irregularity: number; gain: number }): EngineVoiceSpec => ({
  cylinders,
  resonances: sound.resonances,
  irregularity: sound.irregularity,
  gain: sound.gain,
})

export const defaultVoiceSpec = (cylinders: number): EngineVoiceSpec => ({
  cylinders,
  resonances: [110, 340, 900],
  irregularity: 0.03,
  gain: 0.6,
})

export class EngineVoice {
  readonly sr: number
  readonly spec: EngineVoiceSpec
  #phase = 0 // crank cycle phase 0..1 (two revolutions)
  #lastCyl = -1
  #pulse = 0
  #pulseAmp = 0
  readonly #offsets: Float32Array
  readonly #res: BandPass[]
  readonly #intake: BandPass
  readonly #noise = new Noise(1234)
  readonly #dc: OnePole
  readonly #smooth: OnePole
  #rpm = 800
  #load = 0

  constructor(sampleRate: number, spec: EngineVoiceSpec) {
    this.sr = sampleRate
    this.spec = spec
    this.#offsets = new Float32Array(spec.cylinders)
    const n = new Noise(99)
    for (let i = 0; i < spec.cylinders; i++) this.#offsets[i] = n.next() * spec.irregularity
    this.#res = spec.resonances.map((f) => new BandPass(sampleRate, f, 4))
    this.#intake = new BandPass(sampleRate, 1800, 1.2)
    this.#dc = new OnePole(sampleRate, 20)
    this.#smooth = new OnePole(sampleRate, 30)
  }

  /** Firing frequency (Hz) for a 4-stroke engine. */
  static firingHz(rpm: number, cylinders: number): number {
    return (rpm / 60) * (cylinders / 2)
  }

  /** Render `out.length` samples. Parameters are smoothed per-sample. */
  process(out: Float32Array, p: EngineVoiceParams): void {
    const cyl = this.spec.cylinders
    const decay = Math.exp(-1 / (this.sr * 0.0035))
    for (let i = 0; i < out.length; i++) {
      this.#rpm += (p.rpm - this.#rpm) * 0.002
      this.#load = this.#smooth.lp(p.load)
      this.#phase += this.#rpm / 120 / this.sr // cycles per sample (2 revs/cycle)
      if (this.#phase >= 1) this.#phase -= 1
      const slot = Math.floor(this.#phase * cyl)
      const local = this.#phase * cyl - slot
      if (slot !== this.#lastCyl && local >= (this.#offsets[slot] ?? 0) + 0.0) {
        this.#lastCyl = slot
        this.#pulseAmp = 0.35 + 0.65 * this.#load + this.#noise.next() * 0.05
      }
      this.#pulse = this.#pulse * decay + this.#pulseAmp
      this.#pulseAmp = 0
      let exhaust = 0
      for (const r of this.#res) exhaust += r.process(this.#pulse)
      const hiss = this.#intake.process(this.#noise.next()) * (0.05 + 0.25 * p.throttle)
      const y = this.#dc.hp(exhaust * 1.6 + hiss)
      out[i] = softClip(y * this.spec.gain * (0.5 + 0.5 * this.#load))
    }
  }
}
