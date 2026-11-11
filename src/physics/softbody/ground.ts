/** Terrain query interface. Implementations: flat plane, heightfield (later), ramps. */
export interface GroundSample {
  height: number
  nx: number
  ny: number
  nz: number
  friction: number
}

export interface Ground {
  sample(x: number, z: number, out: GroundSample): GroundSample
}

export const newGroundSample = (): GroundSample => ({ height: 0, nx: 0, ny: 1, nz: 0, friction: 1 })

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
    return out
  }
}
