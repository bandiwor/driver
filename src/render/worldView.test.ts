import { describe, expect, it } from 'vitest'
import { CHUNK, LOD_STRIDES, chunkGeometry } from './worldView.ts'
import { buildWorld, type MapDef } from '../world/map.ts'

const map: MapDef = {
  id: 'rv',
  name: 'rv',
  description: '',
  size: 80,
  cell: 1,
  baseHeight: 0,
  baseSurface: 'grass',
  features: [{ kind: 'hill', x: 0, z: 0, radius: 30, height: 5, surface: 'sand' }],
  objects: [],
  spawns: [{ id: 's', name: 's', x: 0, z: 0, yaw: 0 }],
}
const world = buildWorld(map)

describe('terrain chunks', () => {
  it('every LOD of every chunk covers its full cell range (no gaps)', () => {
    const n = world.heightfield.n
    for (const stride of LOD_STRIDES) {
      let area = 0
      for (let j0 = 0; j0 < n - 1; j0 += CHUNK) {
        for (let i0 = 0; i0 < n - 1; i0 += CHUNK) {
          const g = chunkGeometry(world, i0, j0, stride)
          const box = (g.computeBoundingBox(), g.boundingBox!)
          area += (box.max.x - box.min.x) * (box.max.z - box.min.z)
        }
      }
      expect(area).toBeCloseTo(world.heightfield.size ** 2, 3)
    }
  })
  it('vertex heights match the heightfield; skirts hang below', () => {
    const g = chunkGeometry(world, 32, 32, 2)
    const p = g.getAttribute('position')
    const hf = world.heightfield
    let below = 0
    for (let v = 0; v < p.count; v++) {
      const h = hf.heightAt(p.getX(v), p.getZ(v))
      const d = p.getY(v) - h
      expect(d).toBeLessThanOrEqual(1e-4)
      if (d < -0.5) below++
    }
    expect(below).toBeGreaterThan(0)
  })
  it('coarser LODs have far fewer triangles', () => {
    const tris = LOD_STRIDES.map((s) => chunkGeometry(world, 0, 0, s).getIndex()!.count / 3)
    expect(tris[1]!).toBeLessThan(tris[0]! / 3)
    expect(tris[2]!).toBeLessThan(tris[1]! / 2)
  })
})
