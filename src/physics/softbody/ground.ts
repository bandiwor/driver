/** Terrain query interface. Implementations: flat plane, heightfield (world/). */
export interface GroundSample {
  height: number
  nx: number
  ny: number
  nz: number
  /** Surface friction multiplier (asphalt = 1). */
  friction: number
  /** Extra rolling resistance coefficient added to the tyre's (mud, sand…). */
  rolling: number
  /** Tyre stiffness multiplier: < 1 on loose surfaces (gravel, sand). */
  stiffness: number
  /** Surface type index (see world/surfaces.ts), 0 = default. */
  surface: number
}

export interface Ground {
  sample(x: number, z: number, out: GroundSample): GroundSample
}

export const newGroundSample = (): GroundSample => ({ height: 0, nx: 0, ny: 1, nz: 0, friction: 1, rolling: 0, stiffness: 1, surface: 0 })

export class FlatGround implements Ground {
  constructor(
    readonly height = 0,
    readonly friction = 1,
  ) {}
  sample(_x: number, _z: number, out: GroundSample): GroundSample {
    out.height = this.height
    out.nx = 0
    out.ny = 1
    out.nz = 0
    out.friction = this.friction
    out.rolling = 0
    out.stiffness = 1
    out.surface = 0
    return out
  }
}

/** Static obstacles a node can collide with (implemented by world/colliders.ts). */
export interface StaticColliders {
  /** Resolve node at offset i3 in place; returns the impact speed (m/s, 0 = none). */
  collide(pos: Float64Array, vel: Float64Array, i3: number, nodeFriction: number): number
}
