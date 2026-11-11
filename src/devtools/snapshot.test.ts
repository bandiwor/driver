import { describe, expect, it } from 'vitest'
import { parseSnapshotParams } from './snapshot.ts'

describe('parseSnapshotParams', () => {
  it('has sane defaults', () => {
    expect(parseSnapshotParams(new URLSearchParams('snap'))).toEqual({
      vehicle: 'k1-sedan',
      view: 'iso',
      t: 1.5,
      w: 1280,
      h: 720,
      beams: false,
    })
  })
  it('parses values and rejects unknown views', () => {
    const p = parseSnapshotParams(new URLSearchParams('view=top&t=3&w=640&h=480&beams=1'))
    expect(p).toMatchObject({ view: 'top', t: 3, w: 640, h: 480, beams: true })
    expect(() => parseSnapshotParams(new URLSearchParams('view=nope'))).toThrow(/Unknown view/)
  })
})
