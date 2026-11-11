import { describe, expect, it, vi } from 'vitest'
import { EventBus } from './events.ts'

type E = { hit: { force: number }; reset: undefined }

describe('EventBus', () => {
  it('delivers typed payloads and unsubscribes', () => {
    const bus = new EventBus<E>()
    const fn = vi.fn()
    const off = bus.on('hit', fn)
    bus.emit('hit', { force: 3 })
    off()
    bus.emit('hit', { force: 4 })
    expect(fn).toHaveBeenCalledExactlyOnceWith({ force: 3 })
  })
  it('once fires a single time', () => {
    const bus = new EventBus<E>()
    const fn = vi.fn()
    bus.once('reset', fn)
    bus.emit('reset', undefined)
    bus.emit('reset', undefined)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
