/**
 * Visual representation of one vehicle: deformable skinned body, wheels,
 * optional debug beam overlay. `update()` copies interpolated node positions
 * into GPU buffers — no allocations per frame.
 */
import * as THREE from 'three'
import { BeamFlag, type SoftBody } from '../physics/softbody/softbody.ts'
import type { BodyFrame } from '../physics/softbody/frame.ts'
import type { VehicleBody } from '../vehicles/build.ts'
import type { VehicleDef } from '../vehicles/types.ts'
import { buildSkin, SkinGroup } from './skin.ts'

/** Edge stretch ratio at which a panel tears. */
const TEAR = 1.6

const edge = (p: Float32Array, a: number, b: number): number =>
  Math.hypot(p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!)

function edgeLengths(nodeOfVertex: Uint32Array, pos: Float64Array): Float32Array {
  const n = nodeOfVertex.length / 3
  const out = new Float32Array(n * 3)
  const d = (i: number, j: number): number =>
    Math.max(1e-3, Math.hypot(pos[j * 3]! - pos[i * 3]!, pos[j * 3 + 1]! - pos[i * 3 + 1]!, pos[j * 3 + 2]! - pos[i * 3 + 2]!))
  for (let t = 0; t < n; t++) {
    const a = nodeOfVertex[t * 3]!
    const b = nodeOfVertex[t * 3 + 1]!
    const c = nodeOfVertex[t * 3 + 2]!
    out[t * 3] = d(a, b)
    out[t * 3 + 1] = d(b, c)
    out[t * 3 + 2] = d(c, a)
  }
  return out
}

const tmpM = new THREE.Matrix4()
const tmpL = new THREE.Vector3()
const tmpU = new THREE.Vector3()
const tmpF = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Quaternion()
const AXIS_Y = new THREE.Vector3(0, 1, 0)

/** What the view needs per wheel (WheelState satisfies it). */
export interface WheelPose {
  readonly steer: number
  readonly angle: number
}

export class VehicleView {
  readonly root = new THREE.Group()
  readonly #body: SoftBody
  readonly #nodeOfVertex: Uint32Array
  /** Design edge lengths per triangle (3 per tri) for tear detection. */
  readonly #edge0: Float32Array
  readonly #mesh: THREE.Mesh
  readonly #positions: Float32Array
  /** Per wheel: outer group = hub position + body orientation + steer; inner = spin. */
  readonly #wheels: { steer: THREE.Group; spin: THREE.Group }[] = []
  readonly #wheelNodes: readonly number[]
  readonly #beams: THREE.LineSegments
  readonly #beamPos: Float32Array
  readonly #disposables: { dispose(): void }[] = []

  constructor(def: VehicleDef, vb: VehicleBody) {
    this.#body = vb.body
    this.#wheelNodes = vb.wheelNodes
    const skin = buildSkin(vb.map, vb.body.pos)
    this.#nodeOfVertex = skin.nodeOfVertex
    this.#edge0 = edgeLengths(skin.nodeOfVertex, vb.body.pos)
    const geo = new THREE.BufferGeometry()
    this.#positions = new Float32Array(skin.nodeOfVertex.length * 3)
    const posAttr = new THREE.BufferAttribute(this.#positions, 3)
    posAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('position', posAttr)
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.#positions.length), 3))
    let start = 0
    for (let t = 1; t <= skin.groupOfTri.length; t++) {
      if (t === skin.groupOfTri.length || skin.groupOfTri[t] !== skin.groupOfTri[start]) {
        geo.addGroup(start * 3, (t - start) * 3, skin.groupOfTri[start] ?? 0)
        start = t
      }
    }
    const mats: THREE.Material[] = []
    mats[SkinGroup.Paint] = new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.35, roughness: 0.38 })
    mats[SkinGroup.Glass] = new THREE.MeshStandardMaterial({ color: 0x1c2630, metalness: 0.6, roughness: 0.12 })
    mats[SkinGroup.Under] = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 })
    mats[SkinGroup.Interior] = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.8 })
    this.#mesh = new THREE.Mesh(geo, mats)
    this.#mesh.castShadow = true
    this.#mesh.receiveShadow = true
    this.#mesh.frustumCulled = false
    this.root.add(this.#mesh)
    this.#disposables.push(geo, ...mats)

    const tyreGeo = new THREE.CylinderGeometry(def.tyre.radius, def.tyre.radius, def.tyre.width, 28, 1)
    tyreGeo.rotateZ(Math.PI / 2)
    const rimGeo = new THREE.CylinderGeometry(def.tyre.radius * 0.62, def.tyre.radius * 0.62, def.tyre.width * 1.02, 10, 1)
    rimGeo.rotateZ(Math.PI / 2)
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85 })
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.3 })
    // Spokes make the rotation readable (5 bars across the rim face).
    const spokeGeo = new THREE.BoxGeometry(def.tyre.width * 1.06, def.tyre.radius * 1.15, 0.035)
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.6, roughness: 0.4 })
    this.#disposables.push(tyreGeo, rimGeo, tyreMat, rimMat, spokeGeo, spokeMat)
    for (let i = 0; i < def.wheels.length; i++) {
      const steer = new THREE.Group()
      const spin = new THREE.Group()
      const tyre = new THREE.Mesh(tyreGeo, tyreMat)
      tyre.castShadow = true
      spin.add(tyre, new THREE.Mesh(rimGeo, rimMat))
      for (let s = 0; s < 5; s++) {
        const spoke = new THREE.Mesh(spokeGeo, spokeMat)
        spoke.rotation.x = (s * Math.PI) / 5
        spin.add(spoke)
      }
      steer.add(spin)
      this.#wheels.push({ steer, spin })
      this.root.add(steer)
    }

    this.#beamPos = new Float32Array(vb.body.beamCount * 6)
    const bgeo = new THREE.BufferGeometry()
    const battr = new THREE.BufferAttribute(this.#beamPos, 3)
    battr.setUsage(THREE.DynamicDrawUsage)
    bgeo.setAttribute('position', battr)
    const bmat = new THREE.LineBasicMaterial({ color: 0x7cf0ff, transparent: true, opacity: 0.7, depthTest: false })
    this.#beams = new THREE.LineSegments(bgeo, bmat)
    this.#beams.visible = false
    this.#beams.frustumCulled = false
    this.#beams.renderOrder = 10
    this.root.add(this.#beams)
    this.#disposables.push(bgeo, bmat)
  }

  set showBeams(v: boolean) {
    this.#beams.visible = v
  }
  get showBeams(): boolean {
    return this.#beams.visible
  }

  /**
   * @param prev  node positions at previous physics step
   * @param alpha interpolation factor between prev and current
   * @param wheels steer (rad, + left) and spin angle per wheel
   */
  update(prev: Float64Array, alpha: number, frame: BodyFrame, wheels: readonly WheelPose[]): void {
    const cur = this.#body.pos
    const out = this.#positions
    const map = this.#nodeOfVertex
    const ia = 1 - alpha
    for (let v = 0, n = map.length; v < n; v++) {
      const k = map[v]! * 3
      const o = v * 3
      out[o] = prev[k]! * ia + cur[k]! * alpha
      out[o + 1] = prev[k + 1]! * ia + cur[k + 1]! * alpha
      out[o + 2] = prev[k + 2]! * ia + cur[k + 2]! * alpha
    }
    // Torn panels: a triangle stretched far beyond its design edges collapses
    // to a point (the skin "rips", leaving a hole where the beams failed).
    const e0 = this.#edge0
    for (let t = 0, nt = map.length / 3; t < nt; t++) {
      const o = t * 9
      const a = edge(out, o, o + 3)
      const b = edge(out, o + 3, o + 6)
      const c = edge(out, o + 6, o)
      if (a > e0[t * 3]! * TEAR || b > e0[t * 3 + 1]! * TEAR || c > e0[t * 3 + 2]! * TEAR) {
        out[o + 3] = out[o]!
        out[o + 4] = out[o + 1]!
        out[o + 5] = out[o + 2]!
        out[o + 6] = out[o]!
        out[o + 7] = out[o + 1]!
        out[o + 8] = out[o + 2]!
      }
    }
    const geo = this.#mesh.geometry
    geo.getAttribute('position').needsUpdate = true
    geo.computeVertexNormals()

    const m = tmpM
    tmpL.set(frame.uy * frame.fz - frame.uz * frame.fy, frame.uz * frame.fx - frame.ux * frame.fz, frame.ux * frame.fy - frame.uy * frame.fx)
    m.makeBasis(tmpL, tmpU.set(frame.ux, frame.uy, frame.uz), tmpF.set(frame.fx, frame.fy, frame.fz))
    tmpQ.setFromRotationMatrix(m)
    for (let i = 0; i < this.#wheels.length; i++) {
      const { steer, spin } = this.#wheels[i]!
      const pose = wheels[i]
      const k = this.#wheelNodes[i]! * 3
      // Hub node = wheel centre. Steer about body up (+ = left), spin about the axle (+x).
      steer.quaternion.copy(tmpQ).multiply(tmpS.setFromAxisAngle(AXIS_Y, pose?.steer ?? 0))
      steer.position.set(
        prev[k]! * ia + cur[k]! * alpha,
        prev[k + 1]! * ia + cur[k + 1]! * alpha,
        prev[k + 2]! * ia + cur[k + 2]! * alpha,
      )
      spin.rotation.x = pose?.angle ?? 0
    }

    if (this.#beams.visible) {
      const b = this.#body
      const bp = this.#beamPos
      for (let i = 0; i < b.beamCount; i++) {
        const o = i * 6
        if (b.flags[i]! & BeamFlag.Broken) {
          bp.fill(0, o, o + 6)
          continue
        }
        const a3 = b.beamA[i]! * 3
        const b3 = b.beamB[i]! * 3
        bp[o] = cur[a3]!
        bp[o + 1] = cur[a3 + 1]!
        bp[o + 2] = cur[a3 + 2]!
        bp[o + 3] = cur[b3]!
        bp[o + 4] = cur[b3 + 1]!
        bp[o + 5] = cur[b3 + 2]!
      }
      this.#beams.geometry.getAttribute('position').needsUpdate = true
    }
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose()
    this.root.removeFromParent()
  }
}
