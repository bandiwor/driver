/**
 * Visual world built from the same compiled map the physics uses:
 *   - terrain from the heightfield, split into chunks (frustum-culled) with
 *     3 distance LODs each (THREE.LOD) and edge skirts hiding LOD cracks;
 *     vertex colours from the surface table + deterministic variation + slope
 *     shading, a tiling procedural detail texture multiplied on top
 *   - static objects (box colliders) as shaded boxes, coloured per material
 *   - a large skirt plane beyond the map edge (hidden by fog)
 * No image assets; everything is generated.
 */
import * as THREE from 'three'
import type { World } from '../world/map.ts'
import { surfaceAt } from '../world/surfaces.ts'
import { MATERIAL } from '../world/colliders.ts'

const hash = (i: number, j: number): number => {
  let h = (i * 374761393 + j * 668265263) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Chunk size in grid cells and LOD strides (render only; physics uses the full grid). */
export const CHUNK = 32
export const LOD_STRIDES = [1, 2, 4] as const
/** Camera distance (m) at which each LOD level starts. */
export const LOD_DISTANCES = [0, 90, 200] as const
const SKIRT = 0.6

/** Per-vertex colour for grid vertex (i, j): surface colour, variation, slope shading. */
function vertexColor(world: World, i: number, j: number, c: THREE.Color): THREE.Color {
  const hf = world.heightfield
  const n = hf.n
  const k = j * n + i
  const s = surfaceAt(hf.surface[k]!)
  c.setHex(s.color, THREE.SRGBColorSpace)
  const hl = i > 0 && i < n - 1 ? hf.heights[k + 1]! - hf.heights[k - 1]! : 0
  const hz = j > 0 && j < n - 1 ? hf.heights[k + n]! - hf.heights[k - n]! : 0
  const slope = Math.min(1, Math.hypot(hl, hz) / (2 * hf.cell))
  const v = 1 + (hash(i, j) - 0.5) * 2 * s.variation - slope * 0.18
  return c.setRGB(c.r * v, c.g * v, c.b * v)
}

/**
 * Geometry for one terrain chunk [i0, i0+CHUNK] × [j0, j0+CHUNK] at a stride,
 * with skirts on all four edges (hide cracks between neighbouring LODs).
 */
export function chunkGeometry(world: World, i0: number, j0: number, stride: number): THREE.BufferGeometry {
  const hf = world.heightfield
  const n = hf.n
  const i1 = Math.min(i0 + CHUNK, n - 1)
  const j1 = Math.min(j0 + CHUNK, n - 1)
  const is: number[] = []
  const js: number[] = []
  for (let i = i0; i < i1; i += stride) is.push(i)
  is.push(i1)
  for (let j = j0; j < j1; j += stride) js.push(j)
  js.push(j1)
  const w = is.length
  const h = js.length
  const ring = 2 * (w + h) - 4
  const vCount = w * h + ring
  const pos = new Float32Array(vCount * 3)
  const col = new Float32Array(vCount * 3)
  const uv = new Float32Array(vCount * 2)
  const c = new THREE.Color()
  const put = (v: number, i: number, j: number, dy: number): void => {
    const x = hf.vx(i)
    const z = hf.vz(j)
    pos[v * 3] = x
    pos[v * 3 + 1] = hf.heights[j * n + i]! - dy
    pos[v * 3 + 2] = z
    uv[v * 2] = x / 4
    uv[v * 2 + 1] = z / 4
    vertexColor(world, i, j, c)
    col[v * 3] = c.r
    col[v * 3 + 1] = c.g
    col[v * 3 + 2] = c.b
  }
  for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) put(b * w + a, is[a]!, js[b]!, 0)
  const idx: number[] = []
  for (let b = 0; b < h - 1; b++) {
    for (let a = 0; a < w - 1; a++) {
      const p = b * w + a
      idx.push(p, p + w, p + 1, p + 1, p + w, p + w + 1)
    }
  }
  // Skirt: walk the border, duplicate each vertex lowered by SKIRT, stitch.
  const border: number[] = []
  for (let a = 0; a < w; a++) border.push(a)
  for (let b = 1; b < h; b++) border.push(b * w + w - 1)
  for (let a = w - 2; a >= 0; a--) border.push((h - 1) * w + a)
  for (let b = h - 2; b >= 1; b--) border.push(b * w)
  border.forEach((top, k) => {
    const a = top % w
    const b = Math.floor(top / w)
    put(w * h + k, is[a]!, js[b]!, SKIRT)
  })
  for (let k = 0; k < border.length; k++) {
    const t0 = border[k]!
    const t1 = border[(k + 1) % border.length]!
    const s0 = w * h + k
    const s1 = w * h + ((k + 1) % border.length)
    idx.push(t0, t1, s0, t1, s1, s0, t0, s0, t1, t1, s0, s1) // both windings
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/** Neutral tiling detail (grain + faint 1 m grid every 4 m tile). */
function detailTexture(maxAnisotropy: number): THREE.Texture {
  const size = 256
  const cv = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(size, size)
  cv.width = size
  cv.height = size
  const g = cv.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (g) {
    const img = g.createImageData(size, size)
    let s = 9
    for (let p = 0; p < img.data.length; p += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      const v = 222 + (((s >> 16) & 63) - 32)
      img.data[p] = v
      img.data[p + 1] = v
      img.data[p + 2] = v
      img.data[p + 3] = 255
    }
    g.putImageData(img, 0, 0)
    g.strokeStyle = 'rgba(0,0,0,0.08)'
    g.lineWidth = 1
    for (let q = 0; q <= 4; q++) {
      const p = (q * size) / 4
      g.beginPath()
      g.moveTo(p, 0)
      g.lineTo(p, size)
      g.moveTo(0, p)
      g.lineTo(size, p)
      g.stroke()
    }
  }
  const t = new THREE.CanvasTexture(cv)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.anisotropy = maxAnisotropy
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class WorldView {
  readonly root = new THREE.Group()
  chunks = 0
  readonly #disposables: { dispose(): void }[] = []

  constructor(world: World, maxAnisotropy: number) {
    const tex = detailTexture(maxAnisotropy)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.95, metalness: 0 })
    this.#disposables.push(tex, mat)
    // Terrain: chunks (frustum culled) × distance LODs.
    const n = world.heightfield.n
    for (let j0 = 0; j0 < n - 1; j0 += CHUNK) {
      for (let i0 = 0; i0 < n - 1; i0 += CHUNK) {
        const lod = new THREE.LOD()
        LOD_STRIDES.forEach((stride, l) => {
          const geo = chunkGeometry(world, i0, j0, stride)
          this.#disposables.push(geo)
          const mesh = new THREE.Mesh(geo, mat)
          mesh.receiveShadow = true
          mesh.matrixAutoUpdate = false
          lod.addLevel(mesh, LOD_DISTANCES[l]!)
        })
        // LOD is chosen by distance to the chunk centre.
        const sphere = lod.levels[0]!.object instanceof THREE.Mesh ? lod.levels[0]!.object.geometry.boundingSphere : null
        if (sphere) {
          lod.position.copy(sphere.center)
          for (const lv of lod.levels) {
            lv.object.position.copy(sphere.center).negate()
            lv.object.updateMatrix()
          }
        }
        this.chunks++
        this.root.add(lod)
      }
    }

    // Skirt beyond the map edge (a ring: it must not cover terrain below it).
    const hf = world.heightfield
    const skirtMat = new THREE.MeshStandardMaterial({ color: surfaceAt(hf.surface[0]!).color, roughness: 1 })
    const outer = new THREE.Shape()
    outer.moveTo(-2000, -2000)
    outer.lineTo(2000, -2000)
    outer.lineTo(2000, 2000)
    outer.lineTo(-2000, 2000)
    const hole = new THREE.Path()
    const e = hf.half - hf.cell * 0.5
    hole.moveTo(-e, -e)
    hole.lineTo(-e, e)
    hole.lineTo(e, e)
    hole.lineTo(e, -e)
    outer.holes.push(hole)
    const skirt = new THREE.Mesh(new THREE.ShapeGeometry(outer), skirtMat)
    skirt.rotation.x = -Math.PI / 2
    skirt.position.y = world.map.baseHeight - 0.05
    skirt.receiveShadow = true
    this.root.add(skirt)

    // Static objects.
    const box = new THREE.BoxGeometry(1, 1, 1)
    const mats = new Map<string, THREE.Material>()
    for (const b of world.colliders.boxes) {
      let m = mats.get(b.material)
      if (!m) {
        m = new THREE.MeshStandardMaterial({ color: MATERIAL[b.material].color, roughness: b.material === 'metal' ? 0.4 : 0.85, metalness: b.material === 'metal' ? 0.6 : 0 })
        mats.set(b.material, m)
      }
      const mesh = new THREE.Mesh(box, m)
      mesh.scale.set(b.width, b.height, b.length)
      mesh.position.set(b.x, b.y, b.z)
      mesh.rotation.y = b.yaw
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.root.add(mesh)
    }
    this.#disposables.push(skirt.geometry, skirtMat, box, ...mats.values())
  }

  dispose(): void {
    for (const d of this.#disposables) d.dispose()
    this.root.removeFromParent()
  }
}
