/**
 * Surface types. Physics reads friction / rolling / stiffness through
 * GroundSample; render & effects read colours and dust. Registry is
 * extensible (`registerSurface`); maps reference surfaces by id.
 */
export interface SurfaceDef {
  id: string
  name: string
  /** Peak tyre friction multiplier (asphalt 1). */
  friction: number
  /** Extra rolling resistance coefficient (mud ≫ asphalt). */
  rolling: number
  /** Tyre stiffness multiplier: loose surfaces give a softer, flatter slip curve. */
  stiffness: number
  /** Terrain colour (sRGB hex) and its random variation 0..1. */
  color: number
  variation: number
  /** Dust thrown up by wheels (0 = none) and its colour. */
  dust: number
  dustColor: number
  /** Tyre squeal / smoke factor (paved surfaces squeal, loose ones throw dust). */
  squeal: number
}

const list: SurfaceDef[] = []
const byId = new Map<string, number>()

export function registerSurface(s: SurfaceDef): number {
  if (byId.has(s.id)) throw new Error(`Surface "${s.id}" already registered`)
  list.push(s)
  byId.set(s.id, list.length - 1)
  return list.length - 1
}

export const surfaceIndex = (id: string): number => {
  const i = byId.get(id)
  if (i === undefined) throw new Error(`Unknown surface "${id}"`)
  return i
}
export const surfaceAt = (i: number): SurfaceDef => list[i] ?? list[0]!
export const surfaces = (): readonly SurfaceDef[] => list

// Built-ins (index 0 = asphalt, the default for flat test grounds).
registerSurface({ id: 'asphalt', name: 'Асфальт', friction: 1, rolling: 0, stiffness: 1, color: 0x45484d, variation: 0.06, dust: 0, dustColor: 0x888888, squeal: 1 })
registerSurface({ id: 'concrete', name: 'Бетон', friction: 0.95, rolling: 0, stiffness: 1, color: 0x8a8a86, variation: 0.05, dust: 0.05, dustColor: 0xbbbbb5, squeal: 1 })
registerSurface({ id: 'gravel', name: 'Гравий', friction: 0.72, rolling: 0.02, stiffness: 0.55, color: 0x8b7e6a, variation: 0.12, dust: 1, dustColor: 0xb3a58c, squeal: 0.15 })
registerSurface({ id: 'dirt', name: 'Грунт', friction: 0.68, rolling: 0.025, stiffness: 0.6, color: 0x6e5a42, variation: 0.12, dust: 0.9, dustColor: 0x9c8466, squeal: 0.1 })
registerSurface({ id: 'grass', name: 'Трава', friction: 0.55, rolling: 0.03, stiffness: 0.65, color: 0x4f7a35, variation: 0.14, dust: 0.25, dustColor: 0x7d8a5a, squeal: 0 })
registerSurface({ id: 'sand', name: 'Песок', friction: 0.6, rolling: 0.09, stiffness: 0.4, color: 0xc9b07a, variation: 0.08, dust: 1, dustColor: 0xe0cc9c, squeal: 0 })
registerSurface({ id: 'mud', name: 'Грязь', friction: 0.4, rolling: 0.14, stiffness: 0.45, color: 0x4a3a2a, variation: 0.1, dust: 0.3, dustColor: 0x5a4632, squeal: 0 })
registerSurface({ id: 'ice', name: 'Лёд', friction: 0.12, rolling: 0, stiffness: 0.8, color: 0xc8dcea, variation: 0.04, dust: 0, dustColor: 0xffffff, squeal: 0.2 })
