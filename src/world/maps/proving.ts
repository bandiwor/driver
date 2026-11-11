/**
 * "Полигон" — the base proving ground. Zones (clockwise from the start pad):
 *   start pad + asphalt loop   · skidpad with an ice ring
 *   jumps (kicker, table-top)  · hill climb (12°, 20°, 28°)
 *   rally gravel stage + washboard · sand dunes · mud pit · grass fields
 *   crash zone: concrete wall, barrier rows, pillars, tyre stack, blocks
 * Everything is data: copy this file to make a new map.
 */
import type { MapDef } from '../map.ts'
import type { BoxDef } from '../colliders.ts'

const deg = Math.PI / 180

/** Row of identical boxes along +x from (x, z). */
const row = (x: number, z: number, n: number, gap: number, box: Omit<BoxDef, 'x' | 'z'>): BoxDef[] =>
  Array.from({ length: n }, (_, i) => ({ ...box, x: x + i * gap, z }))

export const provingGround: MapDef = {
  id: 'proving',
  name: 'Полигон',
  description: 'Асфальт, гравий, песок, грязь, лёд, трамплины, подъёмы и краш-зона',
  size: 440,
  cell: 1.25,
  baseHeight: 0,
  baseSurface: 'grass',
  features: [
    // Gentle rolling grassland everywhere.
    { kind: 'noise', amplitude: 1.2, scale: 60, seed: 7 },
    // ── central start pad + loop road ──
    { kind: 'level', shape: { type: 'rect', x: 0, z: 0, width: 70, length: 90 }, height: 0, falloff: 12, surface: 'asphalt' },
    {
      kind: 'road',
      points: [
        [-35, -45],
        [-35, -140],
        [60, -160],
        [150, -110],
        [160, 0],
        [150, 110],
        [40, 160],
        [-35, 140],
        [-35, 45],
      ],
      width: 12,
      surface: 'asphalt',
      flatten: 0.9,
      shoulder: 5,
    },
    // ── skidpad: big asphalt circle with an ice ring ──
    { kind: 'level', shape: { type: 'circle', x: 95, z: 0, radius: 45 }, height: 0, falloff: 10, surface: 'asphalt' },
    { kind: 'paint', shape: { type: 'circle', x: 95, z: 0, radius: 30 }, surface: 'ice' },
    { kind: 'paint', shape: { type: 'circle', x: 95, z: 0, radius: 18 }, surface: 'asphalt' },
    // ── jumps (north of the pad) ──
    { kind: 'level', shape: { type: 'rect', x: 0, z: 95, width: 40, length: 70 }, height: 0, falloff: 8, surface: 'concrete' },
    { kind: 'ramp', x: -9, z: 75, yaw: 0, width: 7, length: 9, height: 1.6, kicker: true, back: 3, surface: 'concrete' },
    { kind: 'ramp', x: 9, z: 75, yaw: 0, width: 8, length: 10, height: 1.4, top: 14, back: 10, surface: 'concrete' },
    { kind: 'ramp', x: -9, z: 108, yaw: 0, width: 7, length: 6, height: 0.7, back: 6, surface: 'concrete' },
    // ── hill climb (west): three slopes up to a plateau ──
    { kind: 'level', shape: { type: 'rect', x: -125, z: 40, width: 60, length: 40 }, height: 14, falloff: 2, surface: 'dirt' },
    { kind: 'ramp', x: -140, z: -25, yaw: 0, width: 9, length: 66, height: 14, top: 4, back: 0.01, surface: 'asphalt' }, // 12°
    { kind: 'ramp', x: -125, z: -18, yaw: 0, width: 9, length: 38.5, height: 14, top: 4, back: 0.01, surface: 'concrete' }, // 20°
    { kind: 'ramp', x: -110, z: -6, yaw: 0, width: 9, length: 26.3, height: 14, top: 4, back: 0.01, surface: 'dirt' }, // 28°
    // ── rally gravel stage (south-west) with a washboard section ──
    {
      kind: 'road',
      points: [
        [-35, -60],
        [-80, -75],
        [-120, -110],
        [-150, -160],
        [-110, -195],
        [-60, -180],
        [-40, -150],
      ],
      width: 8,
      surface: 'gravel',
      flatten: 0.6,
      shoulder: 3,
    },
    { kind: 'noise', amplitude: 0.35, scale: 6, seed: 21, shape: { type: 'rect', x: -95, z: -130, width: 140, length: 150 }, falloff: 8 },
    { kind: 'bumps', shape: { type: 'rect', x: -120, z: -110, width: 10, length: 26, yaw: -38 * deg }, amplitude: 0.08, wavelength: 1.2, surface: 'gravel' },
    // ── sand dunes (east) ──
    { kind: 'paint', shape: { type: 'rect', x: 185, z: -40, width: 60, length: 160 }, surface: 'sand' },
    { kind: 'hill', x: 180, z: -80, radius: 22, height: 4.5, surface: 'sand' },
    { kind: 'hill', x: 195, z: -40, radius: 18, height: 3, surface: 'sand' },
    { kind: 'hill', x: 178, z: -2, radius: 25, height: 5.5, surface: 'sand' },
    { kind: 'hill', x: 196, z: 35, radius: 16, height: 2.5, surface: 'sand' },
    // ── mud pit (south-east) ──
    { kind: 'hill', x: 80, z: -100, radius: 26, height: -1.6, surface: 'mud' },
    { kind: 'paint', shape: { type: 'circle', x: 80, z: -100, radius: 20 }, surface: 'mud' },
    // ── dirt trail through the grass (north-east) ──
    {
      kind: 'road',
      points: [
        [40, 60],
        [80, 90],
        [120, 70],
        [150, 110],
      ],
      width: 6,
      surface: 'dirt',
      flatten: 0.3,
    },
    // ── crash zone (south of the pad) ──
    { kind: 'level', shape: { type: 'rect', x: 0, z: -95, width: 60, length: 50 }, height: 0, falloff: 6, surface: 'concrete' },
  ],
  objects: [
    // Crash wall (straight on from the crash spawn).
    { x: 0, z: -118, width: 14, height: 2.2, length: 1.2, yaw: 0, material: 'concrete' },
    // Barrier row (staggered blocks) and pillars.
    ...row(-22, -100, 4, 3.2, { width: 1.6, height: 1.0, length: 0.6, yaw: 0, material: 'concrete' }),
    ...row(14, -104, 3, 5, { width: 0.6, height: 3, length: 0.6, yaw: 0, material: 'metal' }),
    // Tyre stack (bouncy).
    { x: 22, z: -86, width: 4, height: 1.2, length: 2, yaw: 0, material: 'tyres' },
    // Angled guard wall along the pad edge.
    { x: -28, z: -100, width: 0.6, height: 1, length: 30, yaw: 0, material: 'concrete' },
    // Wooden fence by the jumps.
    { x: 22, z: 95, width: 0.3, height: 1.1, length: 50, yaw: 0, material: 'wood' },
  ],
  spawns: [
    { id: 'start', name: 'Старт', x: 0, z: 10, yaw: 0 },
    { id: 'crash', name: 'Краш-зона', x: 0, z: -96, yaw: Math.PI },
    { id: 'jumps', name: 'Трамплины', x: 0, z: 40, yaw: 0 },
    { id: 'skidpad', name: 'Скидпад / лёд', x: 95, z: -38, yaw: Math.PI / 2 },
    { id: 'hill', name: 'Подъёмы', x: -125, z: -45, yaw: 0 },
    { id: 'rally', name: 'Гравий', x: -35, z: -52, yaw: -Math.PI / 2 - 0.3 },
    { id: 'dunes', name: 'Дюны', x: 150, z: -40, yaw: Math.PI / 2 },
    { id: 'mud', name: 'Грязь', x: 80, z: -68, yaw: Math.PI },
  ],
}
