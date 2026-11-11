import { describe, expect, it } from 'vitest'
import { peak, renderBlowOff, renderFlutter, renderPop, rms } from './oneshots.ts'

const SR = 48000
describe.each([
  ['pop', renderPop],
  ['blow-off', renderBlowOff],
  ['flutter', renderFlutter],
] as const)('%s one-shot', (_name, render) => {
  const b = render(SR)
  it('is bounded and audible', () => {
    expect(peak(b)).toBeLessThanOrEqual(1)
    expect(rms(b)).toBeGreaterThan(0.01)
  })
  it('decays to (near) silence', () => {
    const q = Math.floor(b.length / 4)
    expect(rms(b, b.length - q)).toBeLessThan(rms(b, 0, q) * 0.25)
  })
  it('is deterministic per seed', () => {
    expect(render(SR)).toEqual(b)
  })
})
