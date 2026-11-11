/**
 * Simulation = everything that advances at the fixed step: physics world +
 * vehicle runtime (powertrain, frame). DOM-free; identical code runs inline
 * on the main thread or inside the physics worker.
 */
import { PhysicsWorld } from '../physics/softbody/world.ts'
import { Vehicle, pose, type VehiclePose } from '../vehicles/runtime.ts'
import { getVehicle } from '../vehicles/registry.ts'
import type { DriverControls } from '../input/input.ts'
import { buildWorld, spawnHeight, type World } from '../world/map.ts'
import { getMap } from '../world/maps/registry.ts'

export interface SimConfig {
  vehicleId: string
  /** Map id (world/maps/registry.ts) and spawn point id within it. */
  map: string
  spawn: string
  stepHz: number
  substeps: number
}

export const defaultSimConfig = (vehicleId: string, map = 'flat', spawn = 'start'): SimConfig => ({
  vehicleId,
  map,
  spawn,
  stepHz: 120,
  substeps: 16,
})

/** Built worlds are deterministic → memoise per thread (worker and main both build). */
const worlds = new Map<string, World>()
export function worldFor(mapId: string): World {
  let w = worlds.get(mapId)
  if (!w) {
    w = buildWorld(getMap(mapId))
    worlds.set(mapId, w)
  }
  return w
}

/** World pose for a spawn point: on top of the terrain under the car's footprint. */
export function spawnPose(world: World, spawnId: string): VehiclePose {
  const sp = world.map.spawns.find((s) => s.id === spawnId) ?? world.map.spawns[0]
  if (!sp) throw new Error(`Map "${world.map.id}" has no spawns`)
  return pose(sp.x, spawnHeight(world.heightfield, sp.x, sp.z) + 0.05, sp.z, sp.yaw)
}

/** Discrete commands. Serializable (structured clone) for the worker protocol. */
export type SimCommand =
  | { type: 'shift'; delta: 1 | -1 }
  | { type: 'reset' }
  | { type: 'param'; id: string; value: number }
  | { type: 'kick'; node: number; v: readonly [number, number, number] }
  | { type: 'teleport'; spawn: string }

export const newControls = (): DriverControls => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0, starter: 0 })

export const copyControls = (src: DriverControls, dst: DriverControls): void => {
  dst.throttle = src.throttle
  dst.brake = src.brake
  dst.steer = src.steer
  dst.handbrake = src.handbrake
  dst.clutch = src.clutch
  dst.starter = src.starter
}

export class Simulation {
  readonly cfg: SimConfig
  readonly dt: number
  readonly world: PhysicsWorld
  readonly vehicle: Vehicle
  /** Latest driver controls; written by the host, read every step. */
  readonly controls: DriverControls = newControls()
  /** Exponential moving average of step cost, ms. */
  physicsMs = 0
  steps = 0

  readonly map: World
  #impactCooldown = 0

  constructor(cfg: SimConfig) {
    this.cfg = cfg
    this.dt = 1 / cfg.stepHz
    this.map = worldFor(cfg.map)
    this.world = new PhysicsWorld(this.map.heightfield, { substeps: cfg.substeps })
    this.world.colliders = this.map.colliders
    this.vehicle = new Vehicle(getVehicle(cfg.vehicleId), spawnPose(this.map, cfg.spawn), this.world.ground)
    this.world.add(this.vehicle.body)
    this.world.hooks.push(this.vehicle.chassis)
  }

  /**
   * One fixed step. Returns the strength (0..1) of a crash/impact that
   * happened during it (beams breaking or a hard contact), 0 if none.
   */
  step(): number {
    const t0 = performance.now()
    this.vehicle.preStep(this.dt, this.controls)
    this.world.step(this.dt)
    this.vehicle.postStep()
    this.physicsMs = this.physicsMs * 0.9 + (performance.now() - t0) * 0.1
    this.steps++
    const st = this.world.stats
    if (this.#impactCooldown > 0) this.#impactCooldown -= this.dt
    const hit = Math.max(impactStrength(st.broken), contactStrength(st.impact))
    if (hit > 0 && this.#impactCooldown <= 0) {
      this.#impactCooldown = 0.12
      return hit
    }
    return 0
  }

  apply(cmd: SimCommand): void {
    const v = this.vehicle
    switch (cmd.type) {
      case 'shift':
        v.shift(cmd.delta)
        break
      case 'reset':
        v.reset()
        break
      case 'param':
        v.params.set(cmd.id, cmd.value)
        break
      case 'kick': {
        const b = v.body
        const i = cmd.node * 3
        if (cmd.node < 0 || cmd.node >= b.nodeCount) return
        b.vel[i] = b.vel[i]! + cmd.v[0]
        b.vel[i + 1] = b.vel[i + 1]! + cmd.v[1]
        b.vel[i + 2] = b.vel[i + 2]! + cmd.v[2]
        break
      }
      case 'teleport':
        v.placeAt(spawnPose(this.map, cmd.spawn))
        break
    }
  }
}

/** Impact strength (0..1) from broken beam count in one step. */
export const impactStrength = (broken: number): number => Math.min(1, broken / 8)
/** Impact strength (0..1) from the hardest contact speed (m/s); gentle contacts are 0. */
export const contactStrength = (speed: number): number => Math.min(1, Math.max(0, (speed - 4) / 14))
