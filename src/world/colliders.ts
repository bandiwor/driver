/**
 * Static box colliders (walls, barriers, blocks) for soft-body nodes.
 * Boxes are yaw-rotated; a uniform grid broadphase maps each node to a few
 * candidate boxes. Contact = push out along the face of least penetration,
 * remove inward normal velocity (restitution) + Coulomb friction — same model
 * as the ground, so crashes deform the body through its beams.
 * Allocation-free per query.
 */
export interface BoxDef {
  x: number
  /** Centre height; omitted in map data = sits on the terrain. */
  y?: number
  z: number
  width: number // local x
  height: number // y
  length: number // local z
  yaw: number
  material: 'concrete' | 'wood' | 'metal' | 'tyres'
  /** Sink into the terrain by this much (map data). */
  sink?: number
}

export interface BoxCollider extends Required<Omit<BoxDef, 'sink'>> {}

export const MATERIAL: Readonly<Record<BoxDef['material'], { friction: number; restitution: number; color: number }>> = {
  concrete: { friction: 0.7, restitution: 0.05, color: 0x9a9a95 },
  wood: { friction: 0.6, restitution: 0.1, color: 0x9c7446 },
  metal: { friction: 0.35, restitution: 0.15, color: 0x8e979f },
  tyres: { friction: 0.9, restitution: 0.45, color: 0x1c1c1c },
}

const CELL = 8

export interface ContactResult {
  /** Inward normal speed removed (m/s) — impact severity. */
  impact: number
}

export class BoxColliders {
  readonly boxes: readonly BoxCollider[]
  // SoA for the hot path
  readonly #c: Float64Array // cx cy cz hx hy hz cos sin friction restitution → 10
  readonly #grid = new Map<number, number[]>()

  constructor(boxes: readonly (BoxDef & { y: number })[]) {
    this.boxes = boxes.map((b) => ({ x: b.x, y: b.y, z: b.z, width: b.width, height: b.height, length: b.length, yaw: b.yaw, material: b.material }))
    this.#c = new Float64Array(this.boxes.length * 10)
    this.boxes.forEach((b, i) => {
      const o = i * 10
      const m = MATERIAL[b.material]
      this.#c.set([b.x, b.y, b.z, b.width / 2, b.height / 2, b.length / 2, Math.cos(b.yaw), Math.sin(b.yaw), m.friction, m.restitution], o)
      const r = Math.hypot(b.width, b.length) / 2
      for (let gx = Math.floor((b.x - r) / CELL); gx <= Math.floor((b.x + r) / CELL); gx++) {
        for (let gz = Math.floor((b.z - r) / CELL); gz <= Math.floor((b.z + r) / CELL); gz++) {
          const key = cellKey(gx, gz)
          const list = this.#grid.get(key)
          if (list) list.push(i)
          else this.#grid.set(key, [i])
        }
      }
    })
  }

  get count(): number {
    return this.boxes.length
  }

  /**
   * Resolve one node against nearby boxes. Positions/velocities are read and
   * written in place at offset i3 of `pos` / `vel`. Returns the strongest
   * impact speed (0 if no contact).
   */
  collide(pos: Float64Array, vel: Float64Array, i3: number, nodeFriction: number): number {
    if (this.boxes.length === 0) return 0
    const x = pos[i3]!
    const z = pos[i3 + 2]!
    const list = this.#grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)))
    if (!list) return 0
    let impact = 0
    const c = this.#c
    for (let n = 0; n < list.length; n++) {
      const o = list[n]! * 10
      const dx = pos[i3]! - c[o]!
      const dy = pos[i3 + 1]! - c[o + 1]!
      const dz = pos[i3 + 2]! - c[o + 2]!
      const cs = c[o + 6]!
      const sn = c[o + 7]!
      // World → box local (yaw about y): local x = right axis, local z = forward.
      const lx = dx * cs - dz * sn
      const lz = dx * sn + dz * cs
      const px = c[o + 3]! - Math.abs(lx)
      const py = c[o + 4]! - Math.abs(dy)
      const pz = c[o + 5]! - Math.abs(lz)
      if (px <= 0 || py <= 0 || pz <= 0) continue
      // Push out through the face of least penetration.
      let nlx = 0
      let nly = 0
      let nlz = 0
      let depth: number
      if (px <= py && px <= pz) {
        nlx = lx >= 0 ? 1 : -1
        depth = px
      } else if (py <= pz) {
        nly = dy >= 0 ? 1 : -1
        depth = py
      } else {
        nlz = lz >= 0 ? 1 : -1
        depth = pz
      }
      // Local → world normal.
      const nx = nlx * cs + nlz * sn
      const ny = nly
      const nz = -nlx * sn + nlz * cs
      pos[i3] = pos[i3]! + nx * depth
      pos[i3 + 1] = pos[i3 + 1]! + ny * depth
      pos[i3 + 2] = pos[i3 + 2]! + nz * depth
      let vx = vel[i3]!
      let vy = vel[i3 + 1]!
      let vz = vel[i3 + 2]!
      const vn = vx * nx + vy * ny + vz * nz
      if (vn < 0) {
        const jn = -vn * (1 + c[o + 9]!)
        vx += jn * nx
        vy += jn * ny
        vz += jn * nz
        const vnn = vx * nx + vy * ny + vz * nz
        const tx = vx - vnn * nx
        const ty = vy - vnn * ny
        const tz = vz - vnn * nz
        const vt = Math.sqrt(tx * tx + ty * ty + tz * tz)
        if (vt > 1e-9) {
          const k = Math.min(1, (c[o + 8]! * nodeFriction * jn) / vt)
          vx -= tx * k
          vy -= ty * k
          vz -= tz * k
        }
        vel[i3] = vx
        vel[i3 + 1] = vy
        vel[i3 + 2] = vz
        if (-vn > impact) impact = -vn
      }
    }
    return impact
  }
}

const cellKey = (gx: number, gz: number): number => (gx + 4096) * 8192 + (gz + 4096)
