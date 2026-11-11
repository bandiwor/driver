import { describe, expect, it } from 'vitest'
import { Rng } from '../core/rng.ts'
import { TripleReader, TripleWriter, initTripleCell } from './tripleBuffer.ts'

const make = () => {
  const cell = new Int32Array(new SharedArrayBuffer(4))
  initTripleCell(cell)
  return { cell, w: new TripleWriter(cell), r: new TripleReader(cell) }
}

describe('triple buffer', () => {
  it('reader sees nothing until the first publish, then the latest slot', () => {
    const { w, r } = make()
    expect(r.acquire()).toBe(false)
    const written = w.back
    w.publish()
    expect(r.acquire()).toBe(true)
    expect(r.front).toBe(written)
    expect(r.acquire()).toBe(false)
  })

  it('always reads the most recent of several publishes', () => {
    const { w, r } = make()
    const data = [0, 0, 0]
    for (let v = 1; v <= 5; v++) {
      data[w.back] = v
      w.publish()
    }
    r.acquire()
    expect(data[r.front]).toBe(5)
  })

  it('writer and reader never own the same slot (random interleavings)', () => {
    const { cell, w, r } = make()
    const rng = new Rng(42)
    const data = [0, 0, 0]
    let lastSeen = 0
    let value = 0
    for (let i = 0; i < 10_000; i++) {
      if (rng.next() < 0.5) {
        data[w.back] = ++value
        w.publish()
      } else if (r.acquire()) {
        const seen = data[r.front]!
        expect(seen).toBeGreaterThan(lastSeen) // monotonic, never stale/torn
        lastSeen = seen
      }
      const middle = Atomics.load(cell, 0) & 3
      expect(new Set([w.back, r.front, middle]).size).toBe(3)
    }
  })
})
