import { describe, expect, it } from 'vitest'
import { Kernel, token, type Plugin } from './kernel.ts'

type E = { tick: number }
const Counter = token<{ n: number }>('counter')

describe('Kernel', () => {
  it('wires plugins, services and ordered systems', async () => {
    const order: string[] = []
    const a: Plugin<E> = {
      id: 'a',
      setup: (ctx) => {
        ctx.provide(Counter, { n: 0 })
        ctx.addSystem({ id: 'late', order: 10, fixedUpdate: () => void order.push('late') })
      },
    }
    const b: Plugin<E> = {
      id: 'b',
      requires: ['a'],
      setup: (ctx) => {
        const c = ctx.get(Counter)
        ctx.addSystem({ id: 'early', order: 0, fixedUpdate: () => void (c.n++, order.push('early')) })
      },
    }
    const k = await new Kernel<E>().use(a, b)
    k.fixedUpdate(1 / 60)
    expect(order).toEqual(['early', 'late'])
    expect(k.get(Counter).n).toBe(1)
  })
  it('rejects missing deps and duplicate services', async () => {
    const k = new Kernel<E>()
    await expect(k.use({ id: 'x', requires: ['nope'], setup: () => {} })).rejects.toThrow(/requires/)
    k.provide(Counter, { n: 0 })
    expect(() => k.provide(Counter, { n: 1 })).toThrow(/already/)
  })
})
