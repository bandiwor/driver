/** three.js renderer service. The only module (with views) that imports three. */
import * as THREE from 'three'
import type { CameraPose } from './cameraRig.ts'
import { createEnvironment, type Environment } from './environment.ts'

export interface RenderOptions {
  canvas: HTMLCanvasElement
  /** Snapshot mode: fixed size, preserveDrawingBuffer for readback. */
  snapshot?: { width: number; height: number }
  pixelRatioCap?: number
}

export interface RenderInfo {
  calls: number
  triangles: number
}

export class RenderService {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000)
  readonly env: Environment
  readonly #snapshot: boolean
  readonly #ratioCap: number

  constructor(o: RenderOptions) {
    this.#snapshot = !!o.snapshot
    this.#ratioCap = o.pixelRatioCap ?? 2
    this.renderer = new THREE.WebGLRenderer({
      canvas: o.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: this.#snapshot,
    })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.env = createEnvironment(this.scene, this.renderer.capabilities.getMaxAnisotropy())
    if (o.snapshot) {
      this.renderer.setPixelRatio(1)
      this.resize(o.snapshot.width, o.snapshot.height)
    } else {
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, this.#ratioCap))
      this.resize(o.canvas.clientWidth || innerWidth, o.canvas.clientHeight || innerHeight)
    }
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }

  applyPose(p: CameraPose): void {
    const c = this.camera
    c.position.set(p.pos[0], p.pos[1], p.pos[2])
    c.up.set(p.up[0], p.up[1], p.up[2])
    c.lookAt(p.target[0], p.target[1], p.target[2])
    if (c.fov !== p.fov) {
      c.fov = p.fov
      c.updateProjectionMatrix()
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  get info(): RenderInfo {
    const r = this.renderer.info.render
    return { calls: r.calls, triangles: r.triangles }
  }

  dispose(): void {
    this.env.dispose()
    this.renderer.dispose()
  }
}
