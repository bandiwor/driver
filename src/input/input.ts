/**
 * Input: raw device state -> smoothed driver controls. Keyboard bindings are
 * data; gamepad support plugs into the same `DriverControls`. The mapper is
 * DOM-free (feed it key codes) so it is unit-testable.
 */
import { approach, clamp } from '../core/math/scalar.ts'

export type Action =
  | 'throttle'
  | 'brake'
  | 'steerLeft'
  | 'steerRight'
  | 'handbrake'
  | 'clutch'
  | 'shiftUp'
  | 'shiftDown'
  | 'camera'
  | 'reset'
  | 'pause'
  | 'tuning'
  | 'debug'

export type Bindings = Readonly<Record<Action, readonly string[]>>

export const defaultBindings: Bindings = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  handbrake: ['Space'],
  clutch: ['ShiftLeft'],
  shiftUp: ['KeyE'],
  shiftDown: ['KeyQ'],
  camera: ['KeyC'],
  reset: ['KeyR'],
  pause: ['Escape'],
  tuning: ['KeyT'],
  debug: ['F3'],
}

export interface DriverControls {
  throttle: number // 0..1
  brake: number // 0..1
  steer: number // -1 (left) .. 1 (right)
  handbrake: number
  clutch: number // 1 = pedal pressed (disengaged)
}

export interface InputTuning {
  steerSpeed: number // full-lock per second
  steerReturn: number
  pedalSpeed: number
  /** Reduce steering lock with speed (keyboard assist), 0..1. */
  speedSensitivity: number
}

export const defaultInputTuning: InputTuning = { steerSpeed: 2.6, steerReturn: 4, pedalSpeed: 6, speedSensitivity: 0.6 }

export class InputMapper {
  readonly controls: DriverControls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0 }
  readonly #down = new Set<string>()
  readonly #pressed = new Set<Action>()
  readonly #codeToActions = new Map<string, Action[]>()

  constructor(
    bindings: Bindings = defaultBindings,
    public tuning: InputTuning = defaultInputTuning,
  ) {
    for (const [action, codes] of Object.entries(bindings) as [Action, readonly string[]][]) {
      for (const c of codes) this.#codeToActions.set(c, [...(this.#codeToActions.get(c) ?? []), action])
    }
  }

  keyDown(code: string): boolean {
    const acts = this.#codeToActions.get(code)
    if (!acts) return false
    if (!this.#down.has(code)) for (const a of acts) this.#pressed.add(a)
    this.#down.add(code)
    return true
  }

  keyUp(code: string): boolean {
    this.#down.delete(code)
    return this.#codeToActions.has(code)
  }

  /** Releases everything (window blur). */
  clear(): void {
    this.#down.clear()
  }

  held(a: Action): boolean {
    for (const [code, acts] of this.#codeToActions) if (acts.includes(a) && this.#down.has(code)) return true
    return false
  }

  /** Edge-triggered: true once per physical press. */
  consume(a: Action): boolean {
    return this.#pressed.delete(a)
  }

  update(dt: number, speedMs = 0): DriverControls {
    const c = this.controls
    const t = this.tuning
    const p = t.pedalSpeed * dt
    c.throttle = approach(c.throttle, this.held('throttle') ? 1 : 0, p)
    c.brake = approach(c.brake, this.held('brake') ? 1 : 0, p)
    c.handbrake = approach(c.handbrake, this.held('handbrake') ? 1 : 0, p * 2)
    c.clutch = approach(c.clutch, this.held('clutch') ? 1 : 0, p * 2)
    const dir = (this.held('steerRight') ? 1 : 0) - (this.held('steerLeft') ? 1 : 0)
    const limit = 1 / (1 + t.speedSensitivity * Math.max(0, speedMs) * 0.05)
    if (dir !== 0) c.steer = approach(c.steer, dir * limit, t.steerSpeed * dt)
    else c.steer = approach(c.steer, 0, t.steerReturn * dt)
    c.steer = clamp(c.steer, -1, 1)
    return c
  }
}
