import { describe, expect, it } from 'vitest'
import { buildSkin, SkinGroup } from './skin.ts'
import { buildVehicleBody } from '../vehicles/build.ts'
import { sedan } from '../vehicles/sedan.ts'

describe('buildSkin', () => {
  const v = buildVehicleBody(sedan)
  const skin = buildSkin(v.map, v.body.pos)
  it('produces triangles bound only to shell nodes', () => {
    expect(skin.nodeOfVertex.length % 3).toBe(0)
    expect(skin.nodeOfVertex.length / 3).toBe(skin.groupOfTri.length)
    expect(Math.max(...skin.nodeOfVertex)).toBeLessThan(v.shellNodes)
  })
  it('has paint, glass and underbody groups, sorted', () => {
    const groups = [...skin.groupOfTri]
    expect(new Set(groups)).toEqual(new Set([SkinGroup.Paint, SkinGroup.Glass, SkinGroup.Under, SkinGroup.Interior]))
    expect(groups).toEqual([...groups].sort((a, b) => a - b))
  })
})
