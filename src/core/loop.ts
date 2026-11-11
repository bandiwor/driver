/**
 * Fixed-timestep loop with render interpolation.
 * Physics runs at a fixed `stepHz`; rendering gets `alpha` in [0,1) to blend
 * between the last two physics states. Clock + scheduler are injected so the
 * loop is fully deterministic in tests and snapshot mode.
 */
export interface Clock {
  now(): number // milliseconds
}
export interface Scheduler {
  request(cb: () => void): number
  cancel(handle: number): void
}

export interface LoopCallbacks {
  /** Fixed step. `dt` is always 1/stepHz seconds. */
  step(dt: number): void
  /** Once per frame after steps. `alpha` = leftover / dt. */
  render(alpha: number, frameDt: number): void
}

export interface LoopOptions {
  stepHz: number
  /** Upper bound of steps per frame (spiral-of-death guard). */
  maxStepsPerFrame: number
  clock?: Clock
  scheduler?: Scheduler
}

export interface LoopStats {
  frames: number
  steps: number
  droppedMs: number
  lastFrameMs: number
}

/** Tolerance for float accumulation error (seconds). */
const EPS = 1e-9

export class FixedStepLoop {
  readonly dt: number
  readonly stats: LoopStats = { frames: 0, steps: 0, droppedMs: 0, lastFrameMs: 0 }
  timeScale = 1
  paused = false

  readonly #cb: LoopCallbacks
  readonly #max: number
  readonly #clock: Clock
  readonly #scheduler: Scheduler | undefined
  #acc = 0
  #last = -1
  #handle = -1

  constructor(cb: LoopCallbacks, opts: LoopOptions) {
    this.#cb = cb
    this.dt = 1 / opts.stepHz
    this.#max = opts.maxStepsPerFrame
    this.#clock = opts.clock ?? performance
    this.#scheduler = opts.scheduler
  }

  get running(): boolean {
    return this.#handle !== -1
  }

  start(): void {
    if (this.running || !this.#scheduler) return
    this.#last = this.#clock.now()
    const sched = this.#scheduler
    const tick = (): void => {
      this.#handle = sched.request(tick)
      this.frame(this.#clock.now())
    }
    this.#handle = sched.request(tick)
  }

  stop(): void {
    if (this.#scheduler && this.#handle !== -1) this.#scheduler.cancel(this.#handle)
    this.#handle = -1
  }

  /** Advance by wall time `nowMs`. Public for manual / test driving. */
  frame(nowMs: number): void {
    if (this.#last < 0) this.#last = nowMs
    const frameMs = Math.max(0, nowMs - this.#last)
    this.#last = nowMs
    this.stats.frames++
    this.stats.lastFrameMs = frameMs
    if (!this.paused) this.#acc += (frameMs / 1000) * this.timeScale
    let n = 0
    while (this.#acc + EPS >= this.dt && n < this.#max) {
      this.#cb.step(this.dt)
      this.#acc -= this.dt
      n++
    }
    if (n === this.#max && this.#acc + EPS >= this.dt) {
      this.stats.droppedMs += this.#acc * 1000
      this.#acc %= this.dt
    }
    this.stats.steps += n
    this.#cb.render(Math.max(0, this.#acc) / this.dt, frameMs / 1000)
  }

  /** Run exactly `seconds` of simulation synchronously (headless/snapshots). */
  simulate(seconds: number): void {
    const n = Math.round(seconds / this.dt)
    for (let i = 0; i < n; i++) this.#cb.step(this.dt)
    this.stats.steps += n
  }
}

export const rafScheduler: Scheduler = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h),
}
