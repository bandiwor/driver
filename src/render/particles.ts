/**
 * GPU-instanced billboard particle pool.
 *
 *  - Simulation on the CPU in flat typed arrays (SoA), fixed capacity, no
 *    allocations per frame; dead particles are swap-removed so live ones stay
 *    contiguous → one draw call with `instanceCount = live`.
 *  - Rendering: one camera-facing quad per instance (vertex shader billboards
 *    with the camera's right/up vectors), soft round sprite in the fragment
 *    shader, per-particle size and RGBA that evolve over the lifetime.
 *  - Behaviour per particle: linear drag, buoyancy (smoke rises), growth from
 *    size0 → size1, alpha fade-in/out, colour lerp start → end.
 * Separate pools per blend mode (smoke = normal, fire = additive).
 */
import * as THREE from 'three'
import { Rng } from '../core/rng.ts'

export interface EmitParams {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number // s
  size0: number // m
  size1: number // m
  /** Start / end colour (linear 0..1) and peak alpha. */
  r0: number
  g0: number
  b0: number
  r1: number
  g1: number
  b1: number
  alpha: number
  /** Velocity damping per second (air drag), and upward acceleration (m/s²). */
  drag: number
  buoyancy: number
}

export const newEmit = (): EmitParams => ({
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  life: 1,
  size0: 0.2,
  size1: 1,
  r0: 1,
  g0: 1,
  b0: 1,
  r1: 1,
  g1: 1,
  b1: 1,
  alpha: 1,
  drag: 1,
  buoyancy: 0,
})

/** Pure particle state (no three.js) — unit-testable. */
export class ParticleState {
  readonly capacity: number
  live = 0
  readonly pos: Float32Array
  readonly vel: Float32Array
  readonly age: Float32Array
  readonly life: Float32Array
  readonly size: Float32Array // size0, size1
  readonly color: Float32Array // r0 g0 b0 r1 g1 b1
  readonly alpha: Float32Array
  readonly phys: Float32Array // drag, buoyancy
  /** Output per live particle: centre xyz + size, rgba. */
  readonly outOffset: Float32Array
  readonly outColor: Float32Array

  constructor(capacity: number) {
    this.capacity = capacity
    this.pos = new Float32Array(capacity * 3)
    this.vel = new Float32Array(capacity * 3)
    this.age = new Float32Array(capacity)
    this.life = new Float32Array(capacity)
    this.size = new Float32Array(capacity * 2)
    this.color = new Float32Array(capacity * 6)
    this.alpha = new Float32Array(capacity)
    this.phys = new Float32Array(capacity * 2)
    this.outOffset = new Float32Array(capacity * 4)
    this.outColor = new Float32Array(capacity * 4)
  }

  /** Adds a particle; when full, the oldest slot is recycled. Returns the index. */
  emit(p: EmitParams): number {
    let i = this.live
    if (i >= this.capacity) {
      // Recycle the oldest (largest age fraction).
      let best = 0
      let bestF = -1
      for (let k = 0; k < this.capacity; k++) {
        const f = this.age[k]! / this.life[k]!
        if (f > bestF) {
          bestF = f
          best = k
        }
      }
      i = best
    } else this.live++
    const i3 = i * 3
    this.pos[i3] = p.x
    this.pos[i3 + 1] = p.y
    this.pos[i3 + 2] = p.z
    this.vel[i3] = p.vx
    this.vel[i3 + 1] = p.vy
    this.vel[i3 + 2] = p.vz
    this.age[i] = 0
    this.life[i] = Math.max(1e-3, p.life)
    this.size[i * 2] = p.size0
    this.size[i * 2 + 1] = p.size1
    const c = i * 6
    this.color[c] = p.r0
    this.color[c + 1] = p.g0
    this.color[c + 2] = p.b0
    this.color[c + 3] = p.r1
    this.color[c + 4] = p.g1
    this.color[c + 5] = p.b1
    this.alpha[i] = p.alpha
    this.phys[i * 2] = p.drag
    this.phys[i * 2 + 1] = p.buoyancy
    return i
  }

  #move(from: number, to: number): void {
    const f3 = from * 3
    const t3 = to * 3
    this.pos.copyWithin(t3, f3, f3 + 3)
    this.vel.copyWithin(t3, f3, f3 + 3)
    this.age[to] = this.age[from]!
    this.life[to] = this.life[from]!
    this.size.copyWithin(to * 2, from * 2, from * 2 + 2)
    this.color.copyWithin(to * 6, from * 6, from * 6 + 6)
    this.alpha[to] = this.alpha[from]!
    this.phys.copyWithin(to * 2, from * 2, from * 2 + 2)
  }

  /** Integrate, kill expired (swap-remove), write render buffers. */
  update(dt: number): void {
    const { pos, vel, age, life, size, color, alpha, phys, outOffset: oo, outColor: oc } = this
    let i = 0
    while (i < this.live) {
      age[i] = age[i]! + dt
      if (age[i]! >= life[i]!) {
        this.live--
        if (i !== this.live) this.#move(this.live, i)
        continue
      }
      const i3 = i * 3
      const k = Math.max(0, 1 - phys[i * 2]! * dt)
      vel[i3] = vel[i3]! * k
      vel[i3 + 1] = vel[i3 + 1]! * k + phys[i * 2 + 1]! * dt
      vel[i3 + 2] = vel[i3 + 2]! * k
      pos[i3] = pos[i3]! + vel[i3]! * dt
      pos[i3 + 1] = pos[i3 + 1]! + vel[i3 + 1]! * dt
      pos[i3 + 2] = pos[i3 + 2]! + vel[i3 + 2]! * dt
      const t = age[i]! / life[i]!
      // Smooth fade in (first 10%) and out.
      const a = alpha[i]! * Math.min(1, t * 10) * (1 - t) * (1 - t)
      const c = i * 6
      const o = i * 4
      oo[o] = pos[i3]!
      oo[o + 1] = pos[i3 + 1]!
      oo[o + 2] = pos[i3 + 2]!
      oo[o + 3] = size[i * 2]! + (size[i * 2 + 1]! - size[i * 2]!) * Math.sqrt(t)
      oc[o] = color[c]! + (color[c + 3]! - color[c]!) * t
      oc[o + 1] = color[c + 1]! + (color[c + 4]! - color[c + 1]!) * t
      oc[o + 2] = color[c + 2]! + (color[c + 5]! - color[c + 2]!) * t
      oc[o + 3] = a
      i++
    }
  }

  clear(): void {
    this.live = 0
  }
}

const VERT = /* glsl */ `
attribute vec4 iOffset; // xyz centre, w size
attribute vec4 iColor;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vColor = iColor;
  vUv = position.xy;
  // Camera right / up from the view matrix → camera-facing quad.
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world = iOffset.xyz + (right * position.x + up * position.y) * iOffset.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

const FRAG = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
void main() {
  float d = length(vUv) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a *= a;
  if (a * vColor.a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * a);
}`

/** three.js wrapper: one InstancedMesh-like draw for a ParticleState. */
export class ParticlePool {
  readonly state: ParticleState
  readonly mesh: THREE.Mesh
  readonly rng: Rng
  readonly #geo: THREE.InstancedBufferGeometry
  readonly #offset: THREE.InstancedBufferAttribute
  readonly #color: THREE.InstancedBufferAttribute
  readonly #mat: THREE.ShaderMaterial

  constructor(capacity: number, blending: 'normal' | 'additive', seed = 7) {
    this.state = new ParticleState(capacity)
    this.rng = new Rng(seed)
    const geo = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    geo.index = quad.index
    geo.setAttribute('position', quad.getAttribute('position'))
    this.#offset = new THREE.InstancedBufferAttribute(this.state.outOffset, 4)
    this.#color = new THREE.InstancedBufferAttribute(this.state.outColor, 4)
    this.#offset.setUsage(THREE.DynamicDrawUsage)
    this.#color.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('iOffset', this.#offset)
    geo.setAttribute('iColor', this.#color)
    geo.instanceCount = 0
    this.#geo = geo
    this.#mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.mesh = new THREE.Mesh(geo, this.#mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = blending === 'additive' ? 6 : 5
  }

  emit(p: EmitParams): void {
    this.state.emit(p)
  }

  update(dt: number): void {
    const s = this.state
    s.update(dt)
    const n = s.live
    this.#geo.instanceCount = n
    if (n === 0) return
    // Upload only the live range.
    this.#offset.clearUpdateRanges()
    this.#offset.addUpdateRange(0, n * 4)
    this.#offset.needsUpdate = true
    this.#color.clearUpdateRanges()
    this.#color.addUpdateRange(0, n * 4)
    this.#color.needsUpdate = true
  }

  dispose(): void {
    this.#geo.dispose()
    this.#mat.dispose()
    this.mesh.removeFromParent()
  }
}
