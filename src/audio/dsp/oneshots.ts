/**
 * Procedural one-shot samples, rendered once into Float32Arrays (then into
 * AudioBuffers). Pure + deterministic → unit-tested in Node.
 */
import { BandPass, Noise, OnePole, softClip } from './filters.ts'

/**
 * Exhaust afterfire "pop": a sharp pressure spike (filtered noise burst) plus
 * a low body thump with a fast pitch drop, slightly distorted.
 */
export function renderPop(sampleRate: number, seed = 1, seconds = 0.22): Float32Array<ArrayBuffer> {
  const n = Math.round(sampleRate * seconds)
  const out = new Float32Array(n)
  const noise = new Noise(seed)
  const crack = new BandPass(sampleRate, 2200, 0.9)
  const body = new OnePole(sampleRate, 900)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const crackEnv = Math.exp(-t / 0.012)
    const bodyEnv = Math.exp(-t / 0.055)
    const f = 55 + 140 * Math.exp(-t / 0.02) // thump pitch drops quickly
    phase += (2 * Math.PI * f) / sampleRate
    const thump = Math.sin(phase) * bodyEnv
    const c = crack.process(noise.next()) * crackEnv * 3.2
    const rumble = body.lp(noise.next()) * bodyEnv * 0.8
    out[i] = softClip((c + thump * 0.9 + rumble) * 1.2)
  }
  return out
}

/** Blow-off valve vent: band-passed noise "pssh" with a falling centre frequency. */
export function renderBlowOff(sampleRate: number, seed = 3, seconds = 0.6): Float32Array<ArrayBuffer> {
  const n = Math.round(sampleRate * seconds)
  const out = new Float32Array(n)
  const noise = new Noise(seed)
  const bp = new BandPass(sampleRate, 4000, 1.4)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    if (i % 64 === 0) bp.set(1800 + 4200 * Math.exp(-t / 0.18), 1.4)
    const env = Math.min(1, t / 0.008) * Math.exp(-t / 0.16)
    out[i] = softClip(bp.process(noise.next()) * env * 2.5)
  }
  return out
}

/** Compressor surge "flutter" (no blow-off valve): amplitude-modulated chatter. */
export function renderFlutter(sampleRate: number, seed = 5, seconds = 0.5): Float32Array<ArrayBuffer> {
  const n = Math.round(sampleRate * seconds)
  const out = new Float32Array(n)
  const noise = new Noise(seed)
  const bp = new BandPass(sampleRate, 900, 2)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    const rate = 38 - 20 * (t / seconds) // flutter slows down
    const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t)
    const env = Math.exp(-t / 0.2)
    out[i] = softClip(bp.process(noise.next()) * am * am * env * 3)
  }
  return out
}

export const peak = (b: Float32Array): number => b.reduce((m, x) => Math.max(m, Math.abs(x)), 0)
export const rms = (b: Float32Array, from = 0, to = b.length): number => {
  let s = 0
  for (let i = from; i < to; i++) s += b[i]! * b[i]!
  return Math.sqrt(s / Math.max(1, to - from))
}
