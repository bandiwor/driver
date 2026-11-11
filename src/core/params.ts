/**
 * Tunable parameter schema. Vehicles/powertrain/audio declare their knobs as
 * data; the UI auto-generates sliders, presets serialize to JSON, tests can
 * sweep them. Core stays framework-free: a tiny observable store.
 */
export interface ParamDef {
  readonly id: string
  readonly label: string
  readonly group: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly default: number
  readonly unit?: string
  readonly hint?: string
  /** UI widget; default slider. `toggle` means 0/1. */
  readonly kind?: 'slider' | 'toggle'
}

export type ParamValues = Readonly<Record<string, number>>

export class ParamStore {
  readonly defs: readonly ParamDef[]
  readonly #byId: ReadonlyMap<string, ParamDef>
  readonly #values = new Map<string, number>()
  readonly #subs = new Set<(id: string, value: number) => void>()

  constructor(defs: readonly ParamDef[]) {
    this.defs = defs
    const m = new Map<string, ParamDef>()
    for (const d of defs) {
      if (m.has(d.id)) throw new Error(`Duplicate param "${d.id}"`)
      if (!(d.min <= d.default && d.default <= d.max)) throw new Error(`Default out of range: ${d.id}`)
      m.set(d.id, d)
      this.#values.set(d.id, d.default)
    }
    this.#byId = m
  }

  def(id: string): ParamDef {
    const d = this.#byId.get(id)
    if (!d) throw new Error(`Unknown param "${id}"`)
    return d
  }

  get(id: string): number {
    const v = this.#values.get(id)
    if (v === undefined) throw new Error(`Unknown param "${id}"`)
    return v
  }

  set(id: string, value: number): void {
    const d = this.def(id)
    const v = Math.min(d.max, Math.max(d.min, value))
    if (this.#values.get(id) === v) return
    this.#values.set(id, v)
    for (const fn of this.#subs) fn(id, v)
  }

  subscribe(fn: (id: string, value: number) => void): () => void {
    this.#subs.add(fn)
    return () => this.#subs.delete(fn)
  }

  groups(): string[] {
    return [...new Set(this.defs.map((d) => d.group))]
  }

  toJSON(): Record<string, number> {
    return Object.fromEntries(this.#values)
  }

  load(values: ParamValues): void {
    for (const [k, v] of Object.entries(values)) if (this.#byId.has(k)) this.set(k, v)
  }

  reset(): void {
    for (const d of this.defs) this.set(d.id, d.default)
  }
}
