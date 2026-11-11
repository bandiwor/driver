/**
 * Map definition (plain, JSON-serialisable data) and its compiler.
 *
 *   MapDef ──buildWorld()──► { heightfield, colliders, spawns }
 *
 * Terrain is built by applying `features` in order to a heightfield. Each
 * feature kind is a registered function, so new terrain tools are plug-ins:
 *   declare module '…/world/map.ts' { interface TerrainFeatureKinds { crater: CraterDef } }
 *   registerFeature('crater', (f, hf) => { … })
 * Static objects (walls, barriers, blocks) become box colliders.
 */
import { Heightfield } from './heightfield.ts'
import { surfaceIndex } from './surfaces.ts'
import { BoxColliders, type BoxDef } from './colliders.ts'
import { Rng } from '../core/rng.ts'
import { clamp, smoothstep } from '../core/math/scalar.ts'

// ─── shapes ───────────────────────────────────────────────────────────

export type Shape =
  | { type: 'rect'; x: number; z: number; width: number; length: number; yaw?: number }
  | { type: 'circle'; x: number; z: number; radius: number }

// ─── feature kinds (extensible) ───────────────────────────────────────

/** Smooth hill (negative height = pit). Cosine profile. */
export interface HillDef {
  kind: 'hill'
  x: number
  z: number
  radius: number
  height: number
  surface?: string
}
/**
 * Ramp along local +z (yaw rotates it): rises over `length` to `height`,
 * optional flat `top`, then descends over `back` (landing). Raises terrain
 * (max with what is there).
 */
export interface RampDef {
  kind: 'ramp'
  x: number
  z: number
  yaw: number
  width: number
  length: number
  height: number
  top?: number
  back?: number
  /** Curved kicker (true) or straight incline. */
  kicker?: boolean
  surface?: string
}
/** Washboard / bumps: sinusoidal ripples across the local z axis. */
export interface BumpsDef {
  kind: 'bumps'
  shape: Shape
  amplitude: number
  wavelength: number
  surface?: string
}
/** Fractal value noise added over an area (or the whole map). */
export interface NoiseDef {
  kind: 'noise'
  amplitude: number
  scale: number
  seed: number
  shape?: Shape
  /** Fade-out band at the shape edge, m. */
  falloff?: number
}
/** Road along a polyline: paints a surface and (optionally) flattens the cross-section. */
export interface RoadDef {
  kind: 'road'
  points: readonly (readonly [number, number])[]
  width: number
  surface: string
  /** Blend terrain toward a smoothed height along the road (0..1). */
  flatten?: number
  /** Shoulder width blending back into the terrain, m. */
  shoulder?: number
}
/** Paint a surface inside a shape. */
export interface PaintDef {
  kind: 'paint'
  shape: Shape
  surface: string
}
/** Set terrain to a level inside a shape with a smooth edge (pads, plateaus). */
export interface LevelDef {
  kind: 'level'
  shape: Shape
  height: number
  falloff: number
  surface?: string
}

export interface TerrainFeatureKinds {
  hill: HillDef
  ramp: RampDef
  bumps: BumpsDef
  noise: NoiseDef
  road: RoadDef
  paint: PaintDef
  level: LevelDef
}
export type TerrainFeature = TerrainFeatureKinds[keyof TerrainFeatureKinds]

// ─── map definition ──────────────────────────────────────────────────

export interface SpawnPoint {
  id: string
  name: string
  x: number
  z: number
  /** Heading, rad (0 = +z). */
  yaw: number
}

export interface MapDef {
  id: string
  name: string
  description: string
  /** Square side, m (centred on the origin). */
  size: number
  /** Grid spacing, m. */
  cell: number
  baseHeight: number
  baseSurface: string
  features: readonly TerrainFeature[]
  objects: readonly BoxDef[]
  spawns: readonly SpawnPoint[]
}

// ─── feature registry ────────────────────────────────────────────────

type ApplyFn = (f: TerrainFeature, hf: Heightfield) => void
const featureRegistry = new Map<string, ApplyFn>()

export function registerFeature<K extends keyof TerrainFeatureKinds>(
  kind: K,
  apply: (f: TerrainFeatureKinds[K], hf: Heightfield) => void,
): void {
  if (featureRegistry.has(kind)) throw new Error(`Terrain feature "${kind}" already registered`)
  // Keyed by kind: a feature reaching this function always has kind K.
  featureRegistry.set(kind, apply as ApplyFn)
}

// ─── geometry helpers ────────────────────────────────────────────────

/** Local coordinates of (x, z) in a rect frame: u across (width), v along (length). */
const toLocal = (x: number, z: number, cx: number, cz: number, yaw: number): [number, number] => {
  const dx = x - cx
  const dz = z - cz
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  // Forward (local +v) = (sin yaw, cos yaw); right/left (local +u) = (cos yaw, −sin yaw).
  return [dx * c - dz * s, dx * s + dz * c]
}

/** Signed distance to the shape boundary (negative inside). */
export function shapeDistance(s: Shape, x: number, z: number): number {
  if (s.type === 'circle') return Math.hypot(x - s.x, z - s.z) - s.radius
  const [u, v] = toLocal(x, z, s.x, s.z, s.yaw ?? 0)
  const du = Math.abs(u) - s.width / 2
  const dv = Math.abs(v) - s.length / 2
  const outside = Math.hypot(Math.max(du, 0), Math.max(dv, 0))
  return outside + Math.min(Math.max(du, dv), 0)
}

export function shapeBounds(s: Shape, pad = 0): [number, number, number, number] {
  if (s.type === 'circle') return [s.x - s.radius - pad, s.z - s.radius - pad, s.x + s.radius + pad, s.z + s.radius + pad]
  const r = Math.hypot(s.width, s.length) / 2 + pad
  return [s.x - r, s.z - r, s.x + r, s.z + r]
}

/** Closest point on a polyline: distance + the point itself (written into `out`). */
function closestOnPolyline(pts: readonly (readonly [number, number])[], x: number, z: number, out: [number, number]): number {
  let best = Infinity
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, az] = pts[k]!
    const [bx, bz] = pts[k + 1]!
    const dx = bx - ax
    const dz = bz - az
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1)
    const px = ax + dx * t
    const pz = az + dz * t
    const d = Math.hypot(x - px, z - pz)
    if (d < best) {
      best = d
      out[0] = px
      out[1] = pz
    }
  }
  return best
}

/** 2D value noise in [-1, 1] (smooth, deterministic). */
function valueNoise(x: number, z: number, perm: Float32Array): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const fx = x - xi
  const fz = z - zi
  const r = (i: number, j: number): number => perm[((i * 73856093) ^ (j * 19349663)) & 1023]!
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = r(xi, zi) + (r(xi + 1, zi) - r(xi, zi)) * sx
  const b = r(xi, zi + 1) + (r(xi + 1, zi + 1) - r(xi, zi + 1)) * sx
  return a + (b - a) * sz
}

// ─── built-in features ───────────────────────────────────────────────

registerFeature('hill', (f, hf) => {
  const s = f.surface === undefined ? -1 : surfaceIndex(f.surface)
  hf.forEachIn(f.x - f.radius, f.z - f.radius, f.x + f.radius, f.z + f.radius, (k, x, z) => {
    const d = Math.hypot(x - f.x, z - f.z) / f.radius
    if (d >= 1) return
    hf.heights[k] = hf.heights[k]! + f.height * 0.5 * (1 + Math.cos(Math.PI * d))
    if (s >= 0 && d < 0.9) hf.surface[k] = s
  })
})

registerFeature('ramp', (f, hf) => {
  const s = f.surface === undefined ? -1 : surfaceIndex(f.surface)
  const top = f.top ?? 0
  const back = f.back ?? Math.max(2, f.length * 0.6)
  const total = f.length + top + back
  const shape: Shape = { type: 'rect', x: f.x, z: f.z, width: f.width, length: total * 2, yaw: f.yaw }
  const [a, b, c, d] = shapeBounds(shape, 1)
  hf.forEachIn(a, b, c, d, (k, x, z) => {
    const [u, v] = toLocal(x, z, f.x, f.z, f.yaw)
    if (Math.abs(u) > f.width / 2 || v < 0 || v > total) return
    let h: number
    if (v < f.length) {
      const t = v / f.length
      h = f.height * (f.kicker ? t * t : t)
    } else if (v < f.length + top) h = f.height
    else h = f.height * (1 - smoothstep(0, 1, (v - f.length - top) / back))
    // Side edges taper over half a metre so the ramp is not a knife edge.
    h *= clamp((f.width / 2 - Math.abs(u)) / 0.5, 0, 1)
    const base = hf.heights[k]!
    if (base + h > hf.heights[k]!) hf.heights[k] = base + h
    if (s >= 0 && h > 0.01) hf.surface[k] = s
  })
})

registerFeature('bumps', (f, hf) => {
  const s = f.surface === undefined ? -1 : surfaceIndex(f.surface)
  const [a, b, c, d] = shapeBounds(f.shape)
  const yaw = f.shape.type === 'rect' ? (f.shape.yaw ?? 0) : 0
  hf.forEachIn(a, b, c, d, (k, x, z) => {
    const sd = shapeDistance(f.shape, x, z)
    if (sd > 0) return
    const [, v] = toLocal(x, z, f.shape.x, f.shape.z, yaw)
    const edge = clamp(-sd / 1.5, 0, 1)
    hf.heights[k] = hf.heights[k]! + f.amplitude * Math.sin((2 * Math.PI * v) / f.wavelength) * edge
    if (s >= 0) hf.surface[k] = s
  })
})

registerFeature('noise', (f, hf) => {
  const rng = new Rng(f.seed)
  const perm = Float32Array.from({ length: 1024 }, () => rng.range(-1, 1))
  const fall = f.falloff ?? 10
  const [a, b, c, d] = f.shape ? shapeBounds(f.shape) : [-hf.half, -hf.half, hf.half, hf.half]
  hf.forEachIn(a, b, c, d, (k, x, z) => {
    let w = 1
    if (f.shape) {
      const sd = shapeDistance(f.shape, x, z)
      if (sd > 0) return
      w = clamp(-sd / fall, 0, 1)
    }
    let n = 0
    let amp = 1
    let freq = 1 / f.scale
    for (let o = 0; o < 4; o++) {
      n += valueNoise(x * freq, z * freq, perm) * amp
      amp *= 0.5
      freq *= 2.03
    }
    hf.heights[k] = hf.heights[k]! + n * f.amplitude * w
  })
})

registerFeature('paint', (f, hf) => {
  const s = surfaceIndex(f.surface)
  const [a, b, c, d] = shapeBounds(f.shape)
  hf.forEachIn(a, b, c, d, (k, x, z) => {
    if (shapeDistance(f.shape, x, z) <= 0) hf.surface[k] = s
  })
})

registerFeature('level', (f, hf) => {
  const s = f.surface === undefined ? -1 : surfaceIndex(f.surface)
  const [a, b, c, d] = shapeBounds(f.shape, f.falloff)
  hf.forEachIn(a, b, c, d, (k, x, z) => {
    const sd = shapeDistance(f.shape, x, z)
    if (sd > f.falloff) return
    const w = 1 - smoothstep(0, f.falloff, Math.max(0, sd))
    hf.heights[k] = hf.heights[k]! + (f.height - hf.heights[k]!) * w
    if (s >= 0 && sd <= 0) hf.surface[k] = s
  })
})

registerFeature('road', (f, hf) => {
  const s = surfaceIndex(f.surface)
  const shoulder = f.shoulder ?? 2
  const flatten = f.flatten ?? 0
  const half = f.width / 2
  const pad = half + shoulder
  const xs = f.points.map((p) => p[0])
  const zs = f.points.map((p) => p[1])
  const bounds = [Math.min(...xs) - pad, Math.min(...zs) - pad, Math.max(...xs) + pad, Math.max(...zs) + pad] as const
  const p: [number, number] = [0, 0]
  if (flatten > 0) {
    // Flatten across the road toward the terrain height at the centre line
    // (read from an untouched copy so the result does not depend on order).
    const before = new Heightfield(hf.size, hf.cell)
    before.heights.set(hf.heights)
    hf.forEachIn(...bounds, (k, x, z) => {
      const d = closestOnPolyline(f.points, x, z, p)
      if (d > pad) return
      const w = (1 - smoothstep(half, pad, d)) * flatten
      hf.heights[k] = hf.heights[k]! + (before.heightAt(p[0], p[1]) - hf.heights[k]!) * w
    })
  }
  hf.forEachIn(...bounds, (k, x, z) => {
    if (closestOnPolyline(f.points, x, z, p) <= half) hf.surface[k] = s
  })
})

// ─── compiler ────────────────────────────────────────────────────────

export interface World {
  map: MapDef
  heightfield: Heightfield
  colliders: BoxColliders
}

export function buildWorld(map: MapDef): World {
  const hf = new Heightfield(map.size, map.cell)
  hf.heights.fill(map.baseHeight)
  hf.surface.fill(surfaceIndex(map.baseSurface))
  for (const f of map.features) {
    const apply = featureRegistry.get(f.kind)
    if (!apply) throw new Error(`Unknown terrain feature "${f.kind}" in map "${map.id}"`)
    apply(f, hf)
  }
  const colliders = new BoxColliders(map.objects.map((o) => ({ ...o, y: o.y ?? hf.heightAt(o.x, o.z) + o.height / 2 - (o.sink ?? 0) })))
  return { map, heightfield: hf, colliders }
}

/** Height under a spawn footprint (max over a few points) — place cars above it. */
export function spawnHeight(hf: Heightfield, x: number, z: number, radius = 2.6): number {
  let h = -Infinity
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2
    h = Math.max(h, hf.heightAt(x + Math.cos(ang) * radius, z + Math.sin(ang) * radius))
  }
  return Math.max(h, hf.heightAt(x, z))
}
