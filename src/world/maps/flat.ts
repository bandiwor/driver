import type { MapDef } from '../map.ts'

/** Empty asphalt pad — the neutral test ground (used by unit/dynamics tests). */
export const flatMap: MapDef = {
  id: 'flat',
  name: 'Площадка',
  description: 'Ровный асфальт без препятствий',
  size: 600,
  cell: 4,
  baseHeight: 0,
  baseSurface: 'asphalt',
  features: [],
  objects: [],
  spawns: [{ id: 'start', name: 'Старт', x: 0, z: 0, yaw: 0 }],
}
