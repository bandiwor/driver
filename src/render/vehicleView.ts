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

const tmpM = new THREE.Matrix4()
const tmpL = new THREE.Vector3()
const tmpU = new THREE.Vector3()
const tmpF = new THREE.Vector3()

export class VehicleView {
  readonly root = new THREE.Group()
  readonly #body: SoftBody
  readonly #nodeOfVertex: Uint32Array
  readonly #mesh: THREE.Mesh
  readonly #positions: Float32Array
  readonly #wheels: THREE.Group[] = []
  readonly #wheelNodes: readonly number[]
  readonly #radius: number
  readonly #beams: THREE.LineSegments
  readonly #beamPos: Float32Array
  readonly #disposables: { dispose(): void }[] = []

  constructor(def: VehicleDef, vb: VehicleBody) {
    this.#body = vb.body
    this.#wheelNodes = vb.wheelNodes
    this.#radius = def.tyre.radius
    const skin = buildSkin(vb.map, vb.body.pos)
    this.#nodeOfVertex = skin.nodeOfVertex
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
    this.#disposables.push(tyreGeo, rimGeo, tyreMat, rimMat)
    for (let i = 0; i < def.wheels.length; i++) {
      const g = new THREE.Group()
      const tyre = new THREE.Mesh(tyreGeo, tyreMat)
      tyre.castShadow = true
      g.add(tyre, new THREE.Mesh(rimGeo, rimMat))
      this.#wheels.push(g)
      this.root.add(g)
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
   */
  update(prev: Float64Array, alpha: number, frame: BodyFrame): void {
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
    const geo = this.#mesh.geometry
    geo.getAttribute('position').needsUpdate = true
    geo.computeVertexNormals()

    const m = tmpM
    tmpL.set(frame.uy * frame.fz - frame.uz * frame.fy, frame.uz * frame.fx - frame.ux * frame.fz, frame.ux * frame.fy - frame.uy * frame.fx)
    m.makeBasis(tmpL, tmpU.set(frame.ux, frame.uy, frame.uz), tmpF.set(frame.fx, frame.fy, frame.fz))
    for (let i = 0; i < this.#wheels.length; i++) {
      const w = this.#wheels[i]!
      const k = this.#wheelNodes[i]! * 3
      w.quaternion.setFromRotationMatrix(m)
      w.position.set(
        prev[k]! * ia + cur[k]! * alpha + frame.ux * this.#radius,
        prev[k + 1]! * ia + cur[k + 1]! * alpha + frame.uy * this.#radius,
        prev[k + 2]! * ia + cur[k + 2]! * alpha + frame.uz * this.#radius,
      )
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
