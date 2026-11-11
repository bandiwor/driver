/**
 * Camera rig: pure math, no three.js / DOM. Produces a pose from the vehicle frame.
 * Modes:
 *   chase   — 3rd person behind the car (smoothed heading); wheel = distance
 *   cockpit — driver's eye (1st person); drag = look around, wheel = FOV
 *   top     — bird's-eye, "forward" is always up on screen; wheel = height
 *   free    — orbit the car in any direction (world-fixed yaw/pitch), drag
 *             rotates freely, wheel zooms; never goes below the ground
 * `rotate(dx, dy)` / `zoom(factor)` are fed by pointer input (render plugin).
 */
import { clamp, damp } from '../core/math/scalar.ts'
import { localToWorld, type BodyFrame } from '../physics/softbody/frame.ts'

export const CAMERA_MODES = ['chase', 'cockpit', 'top', 'free'] as const
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

/** Limits for user camera control. */
export const RIG_LIMITS = {
  freeDistance: [1.5, 60],
  freePitch: [-1.5, 1.5],
  chaseZoom: [0.5, 3],
  topHeight: [5, 120],
  lookYaw: [-2.6, 2.6],
  lookPitch: [-1.2, 1.2],
  cockpitFov: [35, 100],
  /** Minimum camera height above the ground plane (y = 0), m. */
  minHeight: 0.15,
} as const

const tmp: [number, number, number] = [0, 0, 0]

export class CameraRig {
  mode: CameraMode = 'chase'
  /** Free camera: world yaw/pitch (rad) and distance to the car (m). */
  freeYaw = Math.PI * 0.8
  freePitch = 0.35
  freeDistance = 7
  /** Chase distance multiplier, top-down height, cockpit look + FOV. */
  chaseZoom = 1
  topHeight: number
  lookYaw = 0
  lookPitch = 0
  cockpitFov = 72
  #yaw = 0 // smoothed heading for chase
  #init = false

  constructor(readonly opts: RigOptions) {
    this.topHeight = opts.topHeight
  }

  cycle(): CameraMode {
    const i = CAMERA_MODES.indexOf(this.mode)
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length] ?? 'chase'
    return this.mode
  }

  /** Pointer drag in radians (dx: right, dy: down). */
  rotate(dx: number, dy: number): void {
    if (this.mode === 'cockpit') {
      this.lookYaw = clamp(this.lookYaw - dx, ...RIG_LIMITS.lookYaw)
      this.lookPitch = clamp(this.lookPitch - dy, ...RIG_LIMITS.lookPitch)
      return
    }
    if (this.mode !== 'free') {
      // Grabbing the view in chase/top switches to the free camera from the current angle.
      this.freeYaw = this.#yaw + Math.PI
      this.freePitch = this.mode === 'top' ? 1.3 : 0.3
      this.mode = 'free'
    }
    this.freeYaw -= dx
    this.freePitch = clamp(this.freePitch + dy, ...RIG_LIMITS.freePitch)
  }

  /** Zoom by a factor (> 1 = farther / wider). */
  zoom(factor: number): void {
    switch (this.mode) {
      case 'free':
        this.freeDistance = clamp(this.freeDistance * factor, ...RIG_LIMITS.freeDistance)
        break
      case 'chase':
        this.chaseZoom = clamp(this.chaseZoom * factor, ...RIG_LIMITS.chaseZoom)
        break
      case 'top':
        this.topHeight = clamp(this.topHeight * factor, ...RIG_LIMITS.topHeight)
        break
      case 'cockpit':
        this.cockpitFov = clamp(this.cockpitFov * factor, ...RIG_LIMITS.cockpitFov)
        break
    }
  }

  /** Re-centre the cockpit look direction. */
  resetLook(): void {
    this.lookYaw = 0
    this.lookPitch = 0
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
        const cd = this.opts.chaseDistance * this.chaseZoom
        const ch = this.opts.chaseHeight * this.chaseZoom
        out.pos[0] = f.px - Math.sin(this.#yaw) * cd
        out.pos[1] = f.py + ch
        out.pos[2] = f.pz - Math.cos(this.#yaw) * cd
        setV(out.target, f.px, f.py + 0.6, f.pz)
        setV(out.up, 0, 1, 0)
        out.fov = 62
        break
      }
      case 'cockpit': {
        const [ex, ey, ez] = this.opts.eye
        localToWorld(f, ex, ey, ez, out.pos)
        // Look direction in body space: yaw about up (+ = left), pitch about lateral.
        const cp = Math.cos(this.lookPitch)
        const lxd = Math.sin(this.lookYaw) * cp
        const lyd = Math.sin(this.lookPitch) - 0.005
        const lzd = Math.cos(this.lookYaw) * cp
        localToWorld(f, ex + lxd * 10, ey + lyd * 10, ez + lzd * 10, tmp)
        setV(out.target, tmp[0], tmp[1], tmp[2])
        setV(out.up, f.ux, f.uy, f.uz)
        out.fov = this.cockpitFov
        break
      }
      case 'top': {
        setV(out.pos, f.px, f.py + this.topHeight, f.pz - 0.001)
        setV(out.target, f.px, f.py, f.pz)
        // Screen-up follows vehicle heading so "forward" is always up on screen.
        setV(out.up, Math.sin(this.#yaw), 0, Math.cos(this.#yaw))
        out.fov = 50
        break
      }
      case 'free': {
        const r = this.freeDistance
        const cp = Math.cos(this.freePitch)
        const tx = f.px
        const ty = f.py + 0.3
        const tz = f.pz
        setV(out.target, tx, ty, tz)
        setV(
          out.pos,
          tx + Math.sin(this.freeYaw) * cp * r,
          Math.max(RIG_LIMITS.minHeight, ty + Math.sin(this.freePitch) * r),
          tz + Math.cos(this.freeYaw) * cp * r,
        )
        setV(out.up, 0, 1, 0)
        out.fov = 55
        break
      }
    }
    return out
  }
}

const setV = (v: [number, number, number], x: number, y: number, z: number): void => {
  v[0] = x
  v[1] = y
  v[2] = z
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
  setV(out.up, 0, 1, 0)
  if (view === 'top') setV(out.up, f.fx, 0, f.fz)
  out.fov = view === 'top' ? 45 : 40
  return out
}
