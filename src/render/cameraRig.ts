/**
 * Camera rig: pure math, no three.js. Produces a pose from the vehicle frame.
 * Modes: chase (3rd person), cockpit (1st person), top (bird's-eye),
 * orbit (free mouse orbit), fixed (snapshot presets).
 */
import { damp } from '../core/math/scalar.ts'
import { localToWorld, type BodyFrame } from '../physics/softbody/frame.ts'

export const CAMERA_MODES = ['chase', 'cockpit', 'top', 'orbit'] as const
export type CameraMode = (typeof CAMERA_MODES)[number]

export const SNAP_VIEWS = ['front', 'back', 'left', 'right', 'top', 'iso', 'iso-rear', 'cockpit', 'chase'] as const
export type SnapView = (typeof SNAP_VIEWS)[number]

export interface CameraPose {
  pos: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  fov: number
}

export const newPose = (): CameraPose => ({ pos: [0, 3, -8], target: [0, 0.5, 0], up: [0, 1, 0], fov: 60 })

export interface RigOptions {
  eye: readonly [number, number, number]
  chaseDistance: number
  chaseHeight: number
  topHeight: number
}

const tmp: [number, number, number] = [0, 0, 0]

export class CameraRig {
  mode: CameraMode = 'chase'
  orbitYaw = 0.6
  orbitPitch = 0.35
  orbitDistance = 7
  #yaw = 0 // smoothed heading for chase
  #init = false

  constructor(readonly opts: RigOptions) {}

  cycle(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode)
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length] ?? 'chase'
    return this.mode
  }

  update(f: BodyFrame, dt: number, out: CameraPose): CameraPose {
    const heading = Math.atan2(f.fx, f.fz)
    if (!this.#init) {
      this.#yaw = heading
      this.#init = true
    }
    // Shortest-arc smoothing of heading.
    let d = heading - this.#yaw
    d = Math.atan2(Math.sin(d), Math.cos(d))
    this.#yaw = damp(this.#yaw, this.#yaw + d, 6, dt)
    switch (this.mode) {
      case 'chase': {
        const { chaseDistance: cd, chaseHeight: ch } = this.opts
        out.pos[0] = f.px - Math.sin(this.#yaw) * cd
        out.pos[1] = f.py + ch
        out.pos[2] = f.pz - Math.cos(this.#yaw) * cd
        out.target[0] = f.px
        out.target[1] = f.py + 0.6
        out.target[2] = f.pz
        setUp(out, 0, 1, 0)
        out.fov = 62
        break
      }
      case 'cockpit': {
        const [ex, ey, ez] = this.opts.eye
        localToWorld(f, ex, ey, ez, out.pos)
        localToWorld(f, ex, ey - 0.05, ez + 10, tmp)
        out.target[0] = tmp[0]
        out.target[1] = tmp[1]
        out.target[2] = tmp[2]
        setUp(out, f.ux, f.uy, f.uz)
        out.fov = 72
        break
      }
      case 'top': {
        out.pos[0] = f.px
        out.pos[1] = f.py + this.opts.topHeight
        out.pos[2] = f.pz - 0.001
        out.target[0] = f.px
        out.target[1] = f.py
        out.target[2] = f.pz
        // Screen-up follows vehicle heading so "forward" is always up on screen.
        setUp(out, Math.sin(this.#yaw), 0, Math.cos(this.#yaw))
        out.fov = 50
        break
      }
      case 'orbit': {
        const r = this.orbitDistance
        const cp = Math.cos(this.orbitPitch)
        out.pos[0] = f.px + Math.sin(this.orbitYaw) * cp * r
        out.pos[1] = f.py + Math.sin(this.orbitPitch) * r
        out.pos[2] = f.pz + Math.cos(this.orbitYaw) * cp * r
        out.target[0] = f.px
        out.target[1] = f.py
        out.target[2] = f.pz
        setUp(out, 0, 1, 0)
        out.fov = 55
        break
      }
    }
    return out
  }
}

const setUp = (p: CameraPose, x: number, y: number, z: number): void => {
  p.up[0] = x
  p.up[1] = y
  p.up[2] = z
}

/** Deterministic presets for snapshot / visual testing. */
export function snapPose(view: SnapView, f: BodyFrame, rig: RigOptions, out: CameraPose): CameraPose {
  const d = 6.5
  const presets: Record<Exclude<SnapView, 'cockpit' | 'chase'>, readonly [number, number, number]> = {
    front: [0, 0.6, d],
    back: [0, 0.6, -d],
    left: [d, 0.6, 0],
    right: [-d, 0.6, 0],
    top: [0, 9, 0.001],
    iso: [d * 0.75, d * 0.55, d * 0.75],
    'iso-rear': [-d * 0.75, d * 0.55, -d * 0.75],
  }
  if (view === 'cockpit' || view === 'chase') {
    const r = new CameraRig(rig)
    r.mode = view
    return r.update(f, 0, out)
  }
  const [x, y, z] = presets[view]
  localToWorld(f, x, y, z, out.pos)
  localToWorld(f, 0, 0.1, 0, out.target)
  setUp(out, 0, 1, 0)
  if (view === 'top') {
    out.up[0] = f.fx
    out.up[1] = 0
    out.up[2] = f.fz
  }
  out.fov = view === 'top' ? 45 : 40
  return out
}
