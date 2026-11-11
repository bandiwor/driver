/** Sky, lights and fog. Terrain comes from the map (render/worldView.ts). */
import * as THREE from 'three'

export interface Environment {
  sun: THREE.DirectionalLight
  /** Keep the shadow frustum centred on the focus point. */
  follow(x: number, y: number, z: number): void
  dispose(): void
}

export function createEnvironment(scene: THREE.Scene): Environment {
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

  const sunDir = new THREE.Vector3(-0.45, 0.8, -0.35).normalize().multiplyScalar(40)
  return {
    sun,
    follow(x, y, z) {
      sun.position.set(x + sunDir.x, y + sunDir.y, z + sunDir.z)
      sun.target.position.set(x, y, z)
    },
    dispose() {
      sun.dispose()
    },
  }
}
