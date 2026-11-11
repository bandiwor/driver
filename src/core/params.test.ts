import { describe, expect, it, vi } from 'vitest'
import { ParamStore } from './params.ts'

const defs = [{ id: 'k', label: 'K', group: 'G', min: 0, max: 10, step: 1, default: 5 }] as const

describe('ParamStore', () => {
  it('clamps, notifies, serializes and resets', () => {
    const s = new ParamStore(defs)
    const fn = vi.fn()
    s.subscribe(fn)
    s.set('k', 99)
    expect(s.get('k')).toBe(10)
    expect(fn).toHaveBeenCalledWith('k', 10)
    expect(s.toJSON()).toEqual({ k: 10 })
    s.reset()
    expect(s.get('k')).toBe(5)
  })
  it('validates defaults', () => {
    expect(() => new ParamStore([{ ...defs[0], default: 11 }])).toThrow()
  })
})
