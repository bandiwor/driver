import { describe, expect, it } from 'vitest'
import { EngineVoice, defaultVoiceSpec } from './engineSynth.ts'

const SR = 48000
const render = (rpm: number, load: number, seconds = 0.6): Float32Array => {
  const v = new EngineVoice(SR, defaultVoiceSpec(6))
  const out = new Float32Array(Math.round(SR * seconds))
  // Warm up so parameter smoothing settles.
  const warm = new Float32Array(SR)
  v.process(warm, { rpm, load, throttle: load })
  v.process(out, { rpm, load, throttle: load })
  return out
}
const rms = (b: Float32Array): number => Math.sqrt(b.reduce((s, x) => s + x * x, 0) / b.length)

/** Autocorrelation-based fundamental estimate within [lo, hi] Hz. */
const pitch = (b: Float32Array, lo: number, hi: number): number => {
  let best = 0
  let bestLag = 0
  for (let lag = Math.floor(SR / hi); lag <= Math.ceil(SR / lo); lag++) {
    let s = 0
    for (let i = 0; i + lag < b.length; i++) s += b[i]! * b[i + lag]!
    if (s > best) {
      best = s
      bestLag = lag
    }
  }
  return SR / bestLag
}

describe('EngineVoice', () => {
  it('is bounded and audible', () => {
    const b = render(3000, 0.8)
    expect(rms(b)).toBeGreaterThan(0.02)
    expect(Math.max(...b.map(Math.abs))).toBeLessThanOrEqual(1)
  })
  it('fires at rpm/60 * cyl/2', () => {
    expect(EngineVoice.firingHz(3000, 6)).toBe(150)
    const f = pitch(render(3000, 0.6), 100, 220)
    expect(f).toBeGreaterThan(140)
    expect(f).toBeLessThan(160)
  })
  it('gets louder with load', () => {
    expect(rms(render(3000, 1))).toBeGreaterThan(rms(render(3000, 0)))
  })
})
