/**
 * Kernel = composition root. Everything (physics, render, audio, input, UI
 * bridge, scenes, vehicles) is a Plugin that registers services through typed
 * tokens. Plugins can be swapped by tests (e.g. NullAudio, HeadlessRenderer).
 */
import { EventBus, type EventMap } from './events.ts'

declare const tokenBrand: unique symbol
export interface Token<T> {
  readonly id: string
  readonly [tokenBrand]?: T
}
export const token = <T>(id: string): Token<T> => ({ id }) as Token<T>

/** Systems are ticked in ascending `order` at fixed step and/or per frame. */
export interface System {
  readonly id: string
  readonly order: number
  fixedUpdate?(dt: number): void
  update?(alpha: number, frameDt: number): void
  dispose?(): void
}

export interface KernelContext<E extends EventMap> {
  readonly events: EventBus<E>
  provide<T>(t: Token<T>, value: T): void
  get<T>(t: Token<T>): T
  tryGet<T>(t: Token<T>): T | undefined
  addSystem(s: System): void
}

export interface Plugin<E extends EventMap> {
  readonly id: string
  readonly requires?: readonly string[]
  setup(ctx: KernelContext<E>): void | Promise<void>
}

export class Kernel<E extends EventMap> implements KernelContext<E> {
  readonly events = new EventBus<E>()
  readonly #services = new Map<string, unknown>()
  readonly #systems: System[] = []
  readonly #installed = new Set<string>()

  provide<T>(t: Token<T>, value: T): void {
    if (this.#services.has(t.id)) throw new Error(`Service "${t.id}" already provided`)
    this.#services.set(t.id, value)
  }

  get<T>(t: Token<T>): T {
    if (!this.#services.has(t.id)) throw new Error(`Service "${t.id}" not provided`)
    return this.#services.get(t.id) as T
  }

  tryGet<T>(t: Token<T>): T | undefined {
    return this.#services.get(t.id) as T | undefined
  }

  addSystem(s: System): void {
    this.#systems.push(s)
    this.#systems.sort((a, b) => a.order - b.order)
  }

  get systems(): readonly System[] {
    return this.#systems
  }

  async use(...plugins: Plugin<E>[]): Promise<this> {
    for (const p of plugins) {
      if (this.#installed.has(p.id)) throw new Error(`Plugin "${p.id}" installed twice`)
      for (const r of p.requires ?? []) {
        if (!this.#installed.has(r)) throw new Error(`Plugin "${p.id}" requires "${r}"`)
      }
      await p.setup(this)
      this.#installed.add(p.id)
    }
    return this
  }

  fixedUpdate(dt: number): void {
    for (const s of this.#systems) s.fixedUpdate?.(dt)
  }

  update(alpha: number, frameDt: number): void {
    for (const s of this.#systems) s.update?.(alpha, frameDt)
  }

  dispose(): void {
    for (let i = this.#systems.length - 1; i >= 0; i--) this.#systems[i]?.dispose?.()
    this.#systems.length = 0
    this.#services.clear()
    this.events.clear()
  }
}
