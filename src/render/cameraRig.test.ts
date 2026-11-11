import { describe, expect, it } from 'vitest'
import { CameraRig, newPose, snapPose, SNAP_VIEWS } from './cameraRig.ts'
import { newFrame } from '../physics/softbody/frame.ts'

const opts = { eye: [-0.4, 1.1, 0] as const, chaseDistance: 6, chaseHeight: 2, topHeight: 20 }

const dist = (p: number[]): number => Math.hypot(p[0]!, p[1]! - 0.3, p[2]!)

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
  it('free camera: drag rotates in any direction, wheel zooms, stays above ground', () => {
    const r = new CameraRig(opts)
    r.mode = 'free'
    const a = r.update(newFrame(), 1 / 60, newPose()).pos.slice()
    r.rotate(1.2, 0)
    const b = r.update(newFrame(), 1 / 60, newPose()).pos.slice()
    expect(Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!)).toBeGreaterThan(1)
    r.zoom(2)
    expect(dist(r.update(newFrame(), 1 / 60, newPose()).pos)).toBeCloseTo(14, 1)
    r.zoom(1000)
    expect(r.freeDistance).toBe(60)
    r.rotate(0, -10) // look from below → clamped pitch, camera kept above ground
    expect(r.update(newFrame(), 1 / 60, newPose()).pos[1]).toBeGreaterThanOrEqual(0.15)
  })
  it('dragging in chase switches to the free camera; cockpit drag looks around', () => {
    const r = new CameraRig(opts)
    r.rotate(0.1, 0)
    expect(r.mode).toBe('free')
    r.mode = 'cockpit'
    const p = r.update(newFrame(), 1 / 60, newPose())
    const t0 = p.target.slice()
    r.rotate(-1, 0) // drag left → look left (+x)
    const t1 = r.update(newFrame(), 1 / 60, newPose()).target
    expect(t1[0]).toBeGreaterThan(t0[0]! + 1)
    r.resetLook()
    expect(r.lookYaw).toBe(0)
  })
  it('wheel zoom applies per mode with limits', () => {
    const r = new CameraRig(opts)
    r.zoom(10)
    expect(r.chaseZoom).toBe(3)
    r.mode = 'top'
    r.zoom(0.01)
    expect(r.topHeight).toBe(5)
    r.mode = 'cockpit'
    r.zoom(0.5)
    expect(r.cockpitFov).toBe(36)
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
