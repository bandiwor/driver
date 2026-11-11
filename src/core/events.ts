/** Strictly typed synchronous event bus. Zero allocations on emit. */
export type EventMap = Record<string, unknown>
export type Listener<T> = (payload: T) => void

export class EventBus<M extends EventMap> {
  readonly #listeners = new Map<keyof M, Set<Listener<never>>>()

  on<K extends keyof M>(type: K, fn: Listener<M[K]>): () => void {
    let set = this.#listeners.get(type)
    if (!set) {
      set = new Set()
      this.#listeners.set(type, set)
    }
    set.add(fn as Listener<never>)
    return () => this.off(type, fn)
  }

  once<K extends keyof M>(type: K, fn: Listener<M[K]>): () => void {
    const off = this.on(type, (p) => {
      off()
      fn(p)
    })
    return off
  }

  off<K extends keyof M>(type: K, fn: Listener<M[K]>): void {
    this.#listeners.get(type)?.delete(fn as Listener<never>)
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.#listeners.get(type)
    if (!set) return
    for (const fn of set) (fn as Listener<M[K]>)(payload)
  }

  clear(): void {
    this.#listeners.clear()
  }
}
