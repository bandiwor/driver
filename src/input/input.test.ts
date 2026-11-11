import { describe, expect, it } from 'vitest'
import { InputMapper } from './input.ts'

describe('InputMapper', () => {
  it('ramps pedals and steering smoothly', () => {
    const m = new InputMapper()
    m.keyDown('KeyW')
    m.keyDown('KeyD')
    m.update(0.1)
    expect(m.controls.throttle).toBeCloseTo(0.6)
    expect(m.controls.steer).toBeGreaterThan(0)
    expect(m.controls.steer).toBeLessThan(1)
    for (let i = 0; i < 20; i++) m.update(0.1)
    expect(m.controls.throttle).toBe(1)
    expect(m.controls.steer).toBe(1)
    m.keyUp('KeyD')
    for (let i = 0; i < 20; i++) m.update(0.1)
    expect(m.controls.steer).toBe(0)
  })
  it('edge-triggers discrete actions once per press', () => {
    const m = new InputMapper()
    m.keyDown('KeyE')
    m.keyDown('KeyE') // auto-repeat
    expect(m.consume('shiftUp')).toBe(true)
    expect(m.consume('shiftUp')).toBe(false)
  })
  it('reduces steering lock with speed', () => {
    const m = new InputMapper()
    m.keyDown('KeyA')
    for (let i = 0; i < 50; i++) m.update(0.1, 40)
    expect(m.controls.steer).toBeGreaterThan(-1)
    expect(m.controls.steer).toBeLessThan(-0.2)
  })
})
