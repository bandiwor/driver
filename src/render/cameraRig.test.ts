import { describe, expect, it } from 'vitest'
import { CameraRig, newPose, snapPose, SNAP_VIEWS } from './cameraRig.ts'
import { newFrame } from '../physics/softbody/frame.ts'

const opts = { eye: [-0.4, 1.1, 0] as const, chaseDistance: 6, chaseHeight: 2, topHeight: 20 }

describe('CameraRig', () => {
  it('chase sits behind the car (car faces +z)', () => {
    const p = new CameraRig(opts).update(newFrame(), 1 / 60, newPose())
    expect(p.pos[2]).toBeCloseTo(-6)
    expect(p.pos[1]).toBeCloseTo(2)
  })
  it('cockpit is at the driver eye and looks forward', () => {
    const r = new CameraRig(opts)
    r.mode = 'cockpit'
    const p = r.update(newFrame(), 1 / 60, newPose())
    expect(p.pos).toEqual([-0.4, 1.1, 0].map((v) => expect.closeTo(v)))
    expect(p.target[2]).toBeGreaterThan(p.pos[2])
  })
  it('top looks straight down', () => {
    const r = new CameraRig(opts)
    r.mode = 'top'
    const p = r.update(newFrame(), 1 / 60, newPose())
    expect(p.pos[1] - p.target[1]).toBeCloseTo(20)
  })
  it('cycles through all modes', () => {
    const r = new CameraRig(opts)
    const seen = new Set([r.mode, r.cycle(), r.cycle(), r.cycle()])
    expect(seen.size).toBe(4)
    expect(r.cycle()).toBe('chase')
  })
  it('every snapshot view produces a finite pose', () => {
    for (const v of SNAP_VIEWS) {
      const p = snapPose(v, newFrame(), opts, newPose())
      expect([...p.pos, ...p.target].every(Number.isFinite)).toBe(true)
    }
  })
})
