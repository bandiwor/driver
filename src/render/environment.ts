/** Sky, lights, fog and the procedural ground texture. No image assets. */
import * as THREE from 'three'

export interface Environment {
  sun: THREE.DirectionalLight
  ground: THREE.Mesh
  /** Keep the shadow frustum centred on the focus point. */
  follow(x: number, y: number, z: number): void
  dispose(): void
}

export function createEnvironment(scene: THREE.Scene, maxAnisotropy: number): Environment {
  const sky = new THREE.Color(0x9fb4c8)
  scene.background = sky
  scene.fog = new THREE.Fog(sky, 120, 700)

  const hemi = new THREE.HemisphereLight(0xdfe8f2, 0x3a3326, 1.1)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  const sc = sun.shadow.camera
  sc.left = -14
  sc.right = 14
  sc.top = 14
  sc.bottom = -14
  sc.near = 1
  sc.far = 80
  scene.add(sun, sun.target)

  const tex = new THREE.CanvasTexture(groundCanvas())
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(200, 200)
  tex.anisotropy = maxAnisotropy
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), mat)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  const sunDir = new THREE.Vector3(-0.45, 0.8, -0.35).normalize().multiplyScalar(40)
  return {
    sun,
    ground,
    follow(x, y, z) {
      sun.position.set(x + sunDir.x, y + sunDir.y, z + sunDir.z)
      sun.target.position.set(x, y, z)
    },
    dispose() {
      tex.dispose()
      mat.dispose()
      ground.geometry.dispose()
    },
  }
}

/** 10 m tiles: asphalt-like noise + grid lines every metre, thicker every 10 m. */
function groundCanvas(): HTMLCanvasElement | OffscreenCanvas {
  const size = 512
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(size, size)
  c.width = size
  c.height = size
  const g = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!g) return c
  g.fillStyle = '#4b4f55'
  g.fillRect(0, 0, size, size)
  const img = g.getImageData(0, 0, size, size)
  let s = 7
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const n = ((s >> 16) & 31) - 16
    img.data[i] = (img.data[i] ?? 0) + n
    img.data[i + 1] = (img.data[i + 1] ?? 0) + n
    img.data[i + 2] = (img.data[i + 2] ?? 0) + n
  }
  g.putImageData(img, 0, 0)
  g.strokeStyle = 'rgba(255,255,255,0.08)'
  g.lineWidth = 1
  for (let i = 0; i <= 10; i++) {
    const p = (i * size) / 10
    g.beginPath()
    g.moveTo(p, 0)
    g.lineTo(p, size)
    g.moveTo(0, p)
    g.lineTo(size, p)
    g.stroke()
  }
  g.strokeStyle = 'rgba(255,190,60,0.35)'
  g.lineWidth = 4
  g.strokeRect(0, 0, size, size)
  return c
}
