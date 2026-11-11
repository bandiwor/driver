import { describe, expect, it } from 'vitest'
import { Heightfield } from './heightfield.ts'
import { buildWorld, registerFeature, shapeDistance, spawnHeight, type MapDef } from './map.ts'
import { BoxColliders } from './colliders.ts'
import { surfaceIndex } from './surfaces.ts'
import { getMap, listMaps, parseMap } from './maps/registry.ts'
import { newGroundSample } from '../physics/softbody/ground.ts'

const base = (features: MapDef['features'], objects: MapDef['objects'] = []): MapDef => ({
  id: 't',
  name: 'T',
  description: '',
  size: 100,
  cell: 1,
  baseHeight: 0,
  baseSurface: 'asphalt',
  features,
  objects,
  spawns: [{ id: 's', name: 'S', x: 0, z: 0, yaw: 0 }],
})

describe('Heightfield', () => {
  it('bilinear height + analytic normal on a plane', () => {
    const hf = new Heightfield(10, 1)
    for (let j = 0; j < hf.n; j++) for (let i = 0; i < hf.n; i++) hf.heights[j * hf.n + i] = hf.vx(i) * 0.5 // slope 0.5 in x
    const g = hf.sample(1.3, 2.7, newGroundSample())
    expect(g.height).toBeCloseTo(0.65, 6)
    expect(g.nx).toBeCloseTo(-0.5 / Math.sqrt(1.25), 6)
    expect(g.ny).toBeCloseTo(1 / Math.sqrt(1.25), 6)
  })
  it('clamps outside the map and reports surface properties', () => {
    const hf = new Heightfield(10, 1)
    hf.surface.fill(surfaceIndex('ice'))
    const g = hf.sample(1e6, -1e6, newGroundSample())
    expect(Number.isFinite(g.height)).toBe(true)
    expect(g.friction).toBeLessThan(0.2)
  })
})

describe('terrain features', () => {
  it('hill peaks at the centre, pit goes down, ramp rises to its height', () => {
    const w = buildWorld(
      base([
        { kind: 'hill', x: -20, z: 0, radius: 10, height: 3 },
        { kind: 'hill', x: 20, z: 0, radius: 10, height: -2, surface: 'mud' },
        { kind: 'ramp', x: 0, z: -30, yaw: 0, width: 6, length: 10, height: 2, top: 4 },
      ]),
    )
    const hf = w.heightfield
    expect(hf.heightAt(-20, 0)).toBeCloseTo(3, 1)
    expect(hf.heightAt(20, 0)).toBeCloseTo(-2, 1)
    expect(hf.heightAt(0, -25)).toBeCloseTo(1, 1) // half-way up a linear ramp
    expect(hf.heightAt(0, -18)).toBeCloseTo(2, 1) // on the top
    expect(hf.sample(20, 0, newGroundSample()).surface).toBe(surfaceIndex('mud'))
  })
  it('road paints its surface along the polyline and flattens across', () => {
    const w = buildWorld(
      base([
        { kind: 'hill', x: 0, z: 0, radius: 30, height: 4 },
        {
          kind: 'road',
          points: [
            [-40, 5],
            [40, 5],
          ],
          width: 6,
          surface: 'gravel',
          flatten: 1,
        },
      ]),
    )
    const hf = w.heightfield
    expect(hf.sample(10, 5, newGroundSample()).surface).toBe(surfaceIndex('gravel'))
    expect(hf.sample(10, 15, newGroundSample()).surface).toBe(surfaceIndex('asphalt'))
    // Cross-section flattened: both edges of the road at the centre-line height.
    expect(Math.abs(hf.heightAt(0, 3) - hf.heightAt(0, 7))).toBeLessThan(0.05)
  })
  it('shapes: signed distance inside/outside', () => {
    expect(shapeDistance({ type: 'circle', x: 0, z: 0, radius: 5 }, 0, 0)).toBe(-5)
    expect(shapeDistance({ type: 'rect', x: 0, z: 0, width: 4, length: 2 }, 5, 0)).toBeCloseTo(3)
  })
  it('new feature kinds plug in (crater as a mod would add it)', () => {
    registerFeature('crater', (f, hf) => hf.forEachIn(f.x - 5, f.z - 5, f.x + 5, f.z + 5, (k) => (hf.heights[k] = f.depth)))
    const w = buildWorld(base([{ kind: 'crater', x: 0, z: 0, depth: -3 }]))
    expect(w.heightfield.heightAt(0, 0)).toBe(-3)
  })
  it('unknown feature kinds fail loudly', () => {
    expect(() => buildWorld({ ...base([]), features: [{ kind: 'nope' } as never] })).toThrow(/Unknown terrain feature/)
  })
})

declare module './map.ts' {
  interface TerrainFeatureKinds {
    crater: { kind: 'crater'; x: number; z: number; depth: number }
  }
}

describe('BoxColliders', () => {
  const walls = new BoxColliders([{ x: 0, y: 1, z: 10, width: 10, height: 2, length: 1, yaw: 0, material: 'concrete' }])
  it('pushes a penetrating node out through the nearest face and stops it', () => {
    const pos = new Float64Array([0, 1, 9.6])
    const vel = new Float64Array([0, 0, 20])
    const hit = walls.collide(pos, vel, 0, 1)
    expect(pos[2]).toBeCloseTo(9.5)
    expect(vel[2]).toBeLessThanOrEqual(0)
    expect(hit).toBeCloseTo(20)
  })
  it('respects yaw and ignores far nodes', () => {
    const rot = new BoxColliders([{ x: 0, y: 1, z: 0, width: 1, height: 2, length: 10, yaw: Math.PI / 2, material: 'metal' }])
    const pos = new Float64Array([4, 1, 0.3]) // inside the rotated (now along x) box
    const vel = new Float64Array([0, 0, -5])
    expect(rot.collide(pos, vel, 0, 1)).toBeGreaterThan(0)
    expect(pos[2]).toBeCloseTo(0.5)
    expect(walls.collide(new Float64Array([50, 1, 50]), new Float64Array(3), 0, 1)).toBe(0)
  })
})

describe('maps', () => {
  it('every map builds; spawns sit on the terrain', () => {
    for (const m of listMaps()) {
      const w = buildWorld(m)
      for (const s of m.spawns) expect(Number.isFinite(spawnHeight(w.heightfield, s.x, s.z))).toBe(true)
    }
  })
  it('proving ground has all the advertised surfaces, slopes and obstacles', () => {
    const w = buildWorld(getMap('proving'))
    const found = new Set(w.heightfield.surface)
    for (const s of ['asphalt', 'concrete', 'gravel', 'dirt', 'grass', 'sand', 'mud', 'ice']) expect(found.has(surfaceIndex(s))).toBe(true)
    expect(w.colliders.count).toBeGreaterThan(8)
    // Steepest hill-climb ramp ≈ 28°.
    const g = w.heightfield.sample(-110, 5, newGroundSample())
    expect((Math.acos(g.ny) * 180) / Math.PI).toBeGreaterThan(22)
  })
  it('maps are plain data: JSON round-trip builds the same terrain', () => {
    const m = getMap('proving')
    const back = parseMap(JSON.stringify(m))
    expect(buildWorld(back).heightfield.heights).toEqual(buildWorld(m).heightfield.heights)
    expect(() => parseMap('{"id":"x"}')).toThrow(/missing/)
  })
})
