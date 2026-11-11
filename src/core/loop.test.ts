import { describe, expect, it } from 'vitest'
import { FixedStepLoop } from './loop.ts'

const make = (max = 10) => {
  const log = { steps: 0, alphas: [] as number[] }
  const loop = new FixedStepLoop(
    { step: () => void log.steps++, render: (a) => void log.alphas.push(a) },
    { stepHz: 100, maxStepsPerFrame: max },
  )
  return { loop, log }
}

describe('FixedStepLoop', () => {
  it('runs a fixed number of steps for elapsed time', () => {
    const { loop, log } = make()
    loop.frame(0)
    loop.frame(35) // 3.5 steps
    expect(log.steps).toBe(3)
    expect(log.alphas.at(-1)).toBeCloseTo(0.5, 5)
  })
  it('caps steps per frame and records dropped time', () => {
    const { loop, log } = make(4)
    loop.frame(0)
    loop.frame(1000)
    expect(log.steps).toBe(4)
    expect(loop.stats.droppedMs).toBeGreaterThan(900)
  })
  it('respects pause and timeScale', () => {
    const { loop, log } = make()
    loop.frame(0)
    loop.paused = true
    loop.frame(100)
    expect(log.steps).toBe(0)
    loop.paused = false
    loop.timeScale = 0.5
    loop.frame(200)
    expect(log.steps).toBe(5)
  })
  it('simulate() is deterministic', () => {
    const { loop, log } = make()
    loop.simulate(1.5)
    expect(log.steps).toBe(150)
  })
})
