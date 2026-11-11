import type { MapDef } from '../map.ts'
import { flatMap } from './flat.ts'
import { provingGround } from './proving.ts'

/** Map catalogue. Mods call `registerMap` (MapDef is plain data / JSON). */
const maps = new Map<string, MapDef>([provingGround, flatMap].map((m) => [m.id, m]))

export const registerMap = (m: MapDef): void => {
  if (maps.has(m.id)) throw new Error(`Map "${m.id}" already registered`)
  maps.set(m.id, m)
}
export const getMap = (id: string): MapDef => {
  const m = maps.get(id)
  if (!m) throw new Error(`Unknown map "${id}"`)
  return m
}
export const hasMap = (id: string): boolean => maps.has(id)
export const listMaps = (): MapDef[] => [...maps.values()]

/** Parse a map from JSON (e.g. a file made by hand or an editor) and validate the basics. */
export function parseMap(json: string): MapDef {
  const m = JSON.parse(json) as Partial<MapDef>
  const need = ['id', 'name', 'size', 'cell', 'baseSurface', 'features', 'objects', 'spawns'] as const
  for (const k of need) if (m[k] === undefined) throw new Error(`Map JSON: missing "${k}"`)
  const def = m as MapDef
  if (def.spawns.length === 0) throw new Error('Map JSON: needs at least one spawn')
  return { ...def, baseHeight: def.baseHeight ?? 0, description: def.description ?? '' }
}
