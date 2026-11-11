/**
 * Node–beam soft body (mass-spring network) stored as flat typed arrays (SoA).
 * Hot path friendly: no objects per node/beam, no allocations per step,
 * transferable / SharedArrayBuffer-compatible.
 */
export const BeamFlag = {
  None: 0,
  Broken: 1,
  /** Support beam: only resists compression (e.g. body panels vs. frame). */
  CompressionOnly: 2,
} as const

export interface SoftBody {
  readonly nodeCount: number
  readonly beamCount: number
  /** xyz interleaved, metres (f64 for integration stability). */
  readonly pos: Float64Array
  readonly vel: Float64Array
  readonly force: Float64Array
  readonly invMass: Float64Array
  readonly nodeFriction: Float32Array
  readonly beamA: Uint32Array
  readonly beamB: Uint32Array
  /** Current (plastically deformed) rest length. */
  readonly rest: Float64Array
  /** Original rest length, for damage metrics / repair. */
  readonly rest0: Float64Array
  readonly spring: Float64Array // N/m
  readonly damp: Float64Array // N·s/m
  /** |strain| above which rest length yields (plastic deformation). */
  readonly yieldStrain: Float32Array
  /** |strain| above which the beam breaks. */
  readonly breakStrain: Float32Array
  readonly flags: Uint8Array
  /** Initial positions, for reset. */
  readonly pos0: Float64Array
}

export interface NodeOpts {
  mass: number
  friction?: number
}
export interface BeamOpts {
  spring: number
  damp: number
  yieldStrain?: number
  breakStrain?: number
  flags?: number
}

export class SoftBodyBuilder {
  readonly #nodes: number[] = []
  readonly #mass: number[] = []
  readonly #fric: number[] = []
  readonly #beams: { a: number; b: number; o: BeamOpts }[] = []
  readonly #beamKeys = new Set<string>()

  get nodeCount(): number {
    return this.#mass.length
  }
  get beamCount(): number {
    return this.#beams.length
  }

  addNode(x: number, y: number, z: number, o: NodeOpts): number {
    if (!(o.mass > 0)) throw new Error('Node mass must be > 0')
    this.#nodes.push(x, y, z)
    this.#mass.push(o.mass)
    this.#fric.push(o.friction ?? 0.8)
    return this.#mass.length - 1
  }

  /** Adds a beam; duplicate (a,b)/(b,a) pairs are ignored. Returns beam index or -1. */
  addBeam(a: number, b: number, o: BeamOpts): number {
    const n = this.nodeCount
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) throw new Error(`Bad beam ${a}-${b}`)
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (this.#beamKeys.has(key)) return -1
    this.#beamKeys.add(key)
    this.#beams.push({ a, b, o })
    return this.#beams.length - 1
  }

  build(): SoftBody {
    const n = this.nodeCount
    const m = this.beamCount
    const pos = Float64Array.from(this.#nodes)
    const body: SoftBody = {
      nodeCount: n,
      beamCount: m,
      pos,
      pos0: pos.slice(),
      vel: new Float64Array(n * 3),
      force: new Float64Array(n * 3),
      invMass: Float64Array.from(this.#mass, (v) => 1 / v),
      nodeFriction: Float32Array.from(this.#fric),
      beamA: new Uint32Array(m),
      beamB: new Uint32Array(m),
      rest: new Float64Array(m),
      rest0: new Float64Array(m),
      spring: new Float64Array(m),
      damp: new Float64Array(m),
      yieldStrain: new Float32Array(m),
      breakStrain: new Float32Array(m),
      flags: new Uint8Array(m),
    }
    this.#beams.forEach(({ a, b, o }, i) => {
      const dx = (pos[b * 3] ?? 0) - (pos[a * 3] ?? 0)
      const dy = (pos[b * 3 + 1] ?? 0) - (pos[a * 3 + 1] ?? 0)
      const dz = (pos[b * 3 + 2] ?? 0) - (pos[a * 3 + 2] ?? 0)
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (L < 1e-6) throw new Error(`Zero-length beam ${a}-${b}`)
      body.beamA[i] = a
      body.beamB[i] = b
      body.rest[i] = L
      body.rest0[i] = L
      body.spring[i] = o.spring
      body.damp[i] = o.damp
      body.yieldStrain[i] = o.yieldStrain ?? Infinity
      body.breakStrain[i] = o.breakStrain ?? Infinity
      body.flags[i] = o.flags ?? BeamFlag.None
    })
    return body
  }
}

export const totalMass = (b: SoftBody): number => {
  let m = 0
  for (let i = 0; i < b.nodeCount; i++) m += 1 / (b.invMass[i] ?? Infinity)
  return m
}

export const centerOfMass = (b: SoftBody, out: Float64Array = new Float64Array(3)): Float64Array => {
  let mx = 0
  let my = 0
  let mz = 0
  let mt = 0
  for (let i = 0; i < b.nodeCount; i++) {
    const m = 1 / (b.invMass[i] ?? Infinity)
    mx += (b.pos[i * 3] ?? 0) * m
    my += (b.pos[i * 3 + 1] ?? 0) * m
    mz += (b.pos[i * 3 + 2] ?? 0) * m
    mt += m
  }
  out[0] = mx / mt
  out[1] = my / mt
  out[2] = mz / mt
  return out
}

/** 0 = pristine, grows with plastic deformation and broken beams. */
export const damage = (b: SoftBody): number => {
  let d = 0
  for (let i = 0; i < b.beamCount; i++) {
    if ((b.flags[i] ?? 0) & BeamFlag.Broken) d += 1
    else d += Math.abs((b.rest[i] ?? 0) - (b.rest0[i] ?? 0)) / (b.rest0[i] ?? 1)
  }
  return d / Math.max(1, b.beamCount)
}

export const resetBody = (b: SoftBody): void => {
  b.pos.set(b.pos0)
  b.vel.fill(0)
  b.force.fill(0)
  b.rest.set(b.rest0)
  for (let i = 0; i < b.beamCount; i++) b.flags[i] = (b.flags[i] ?? 0) & ~BeamFlag.Broken
}

export const translateBody = (b: SoftBody, x: number, y: number, z: number): void => {
  for (let i = 0; i < b.nodeCount; i++) {
    b.pos[i * 3] = (b.pos[i * 3] ?? 0) + x
    b.pos[i * 3 + 1] = (b.pos[i * 3 + 1] ?? 0) + y
    b.pos[i * 3 + 2] = (b.pos[i * 3 + 2] ?? 0) + z
  }
}
