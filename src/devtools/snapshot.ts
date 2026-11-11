/**
 * Snapshot / visual-test mode. Deterministic: no rAF loop, no input, no audio.
 *   /?snap&vehicle=k1-sedan&view=iso&t=1.5&w=1280&h=720&beams=1
 * After rendering sets <html data-snap="ready">. `window.__kuzov` lets
 * Playwright (scripts/snap.mjs) re-pose / re-simulate without reloading.
 */
import { Kernel } from '../core/kernel.ts'
import { FixedStepLoop } from '../core/loop.ts'
import { physicsPlugin, renderPlugin, vehiclePlugin } from '../app/plugins.ts'
import { T, type GameEvents } from '../app/tokens.ts'
import { newPose, snapPose, SNAP_VIEWS, type SnapView } from '../render/cameraRig.ts'

export interface SnapshotParams {
  vehicle: string
  view: SnapView
  t: number
  w: number
  h: number
  beams: boolean
}

export function parseSnapshotParams(q: URLSearchParams): SnapshotParams {
  const view = q.get('view') ?? 'iso'
  if (!(SNAP_VIEWS as readonly string[]).includes(view)) throw new Error(`Unknown view "${view}". Use: ${SNAP_VIEWS.join(', ')}`)
  const num = (k: string, d: number): number => {
    const v = Number(q.get(k) ?? d)
    return Number.isFinite(v) ? v : d
  }
  return {
    vehicle: q.get('vehicle') ?? 'k1-sedan',
    view: view as SnapView,
    t: num('t', 1.5),
    w: num('w', 1280),
    h: num('h', 720),
    beams: q.get('beams') === '1',
  }
}

export interface SnapshotApi {
  setView(view: SnapView): void
  simulate(seconds: number): void
  setBeams(on: boolean): void
  /** Arbitrary per-node impulse for deformation tests: (nodeIndex, vx, vy, vz). */
  kick(node: number, vx: number, vy: number, vz: number): void
  render(): void
  debug(): unknown
  info(): { nodes: number; beams: number; damage: number; triangles: number; calls: number }
}

declare global {
  interface Window {
    __kuzov?: SnapshotApi
  }
}

export async function runSnapshot(canvas: HTMLCanvasElement, p: SnapshotParams): Promise<SnapshotApi> {
  document.documentElement.dataset['snap'] = 'loading'
  canvas.style.width = `${p.w}px`
  canvas.style.height = `${p.h}px`
  const k = new Kernel<GameEvents>()
  const loop = new FixedStepLoop({ step: (dt) => k.fixedUpdate(dt), render: (a, f) => k.update(a, f) }, { stepHz: 120, maxStepsPerFrame: 8 })
  k.provide(T.loop, loop)
  await k.use(physicsPlugin(), vehiclePlugin(p.vehicle), renderPlugin({ canvas, snapshot: { width: p.w, height: p.h } }))
  const v = k.get(T.vehicle)
  const r = k.get(T.render)
  const view = k.get(T.vehicleView)
  const rig = k.get(T.camera)
  const pose = newPose()
  let current = p.view
  const api: SnapshotApi = {
    setView(next) {
      current = next
      api.render()
    },
    simulate(s) {
      loop.simulate(s)
      api.render()
    },
    setBeams(on) {
      view.showBeams = on
      api.render()
    },
    kick(node, vx, vy, vz) {
      const b = v.body
      b.vel[node * 3] = (b.vel[node * 3] ?? 0) + vx
      b.vel[node * 3 + 1] = (b.vel[node * 3 + 1] ?? 0) + vy
      b.vel[node * 3 + 2] = (b.vel[node * 3 + 2] ?? 0) + vz
    },
    render() {
      view.update(v.body.pos, 1, v.frame)
      snapPose(current, v.frame, rig.opts, pose)
      r.applyPose(pose)
      r.env.follow(v.frame.px, 0, v.frame.pz)
      r.render()
      document.documentElement.dataset['snap'] = 'ready'
    },
    debug: () => ({ pose: structuredClone(pose), frame: { ...v.frame }, eye: rig.opts.eye, cam: r.camera.position.toArray() }),
    info: () => ({
      nodes: v.body.nodeCount,
      beams: v.body.beamCount,
      damage: v.telemetry({ speedKmh: 0, rpm: 0, gear: 'N', throttle: 0, load: 0, damage: 0, limiter: false }).damage,
      ...r.info,
    }),
  }
  view.showBeams = p.beams
  window.__kuzov = api
  api.simulate(p.t)
  return api
}
