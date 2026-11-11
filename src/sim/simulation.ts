/**
 * Simulation = everything that advances at the fixed step: physics world +
 * vehicle runtime (powertrain, frame). DOM-free; identical code runs inline
 * on the main thread or inside the physics worker.
 */
import { PhysicsWorld } from '../physics/softbody/world.ts'
import { FlatGround } from '../physics/softbody/ground.ts'
import { Vehicle } from '../vehicles/runtime.ts'
import { getVehicle } from '../vehicles/registry.ts'
import type { DriverControls } from '../input/input.ts'

export interface SimConfig {
  vehicleId: string
  spawn: readonly [number, number, number]
  stepHz: number
  substeps: number
}

export const defaultSimConfig = (vehicleId: string): SimConfig => ({
  vehicleId,
  spawn: [0, 0.05, 0],
  stepHz: 120,
  substeps: 16,
})

/** Discrete commands. Serializable (structured clone) for the worker protocol. */
export type SimCommand =
  | { type: 'shift'; delta: 1 | -1 }
  | { type: 'reset' }
  | { type: 'param'; id: string; value: number }
  | { type: 'kick'; node: number; v: readonly [number, number, number] }

export const newControls = (): DriverControls => ({ throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0 })

export const copyControls = (src: DriverControls, dst: DriverControls): void => {
  dst.throttle = src.throttle
  dst.brake = src.brake
  dst.steer = src.steer
  dst.handbrake = src.handbrake
  dst.clutch = src.clutch
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

  constructor(cfg: SimConfig) {
    this.cfg = cfg
    this.dt = 1 / cfg.stepHz
    this.world = new PhysicsWorld(new FlatGround(0), { substeps: cfg.substeps })
    this.vehicle = new Vehicle(getVehicle(cfg.vehicleId), cfg.spawn)
    this.world.add(this.vehicle.body)
  }

  /** One fixed step. Returns the number of beams broken during it. */
  step(): number {
    const t0 = performance.now()
    this.vehicle.preStep(this.dt, this.controls)
    this.world.step(this.dt)
    this.vehicle.postStep()
    this.physicsMs = this.physicsMs * 0.9 + (performance.now() - t0) * 0.1
    this.steps++
    return this.world.stats.broken
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
    }
  }
}

/** Impact strength (0..1) from broken beam count in one step. */
export const impactStrength = (broken: number): number => Math.min(1, broken / 8)
