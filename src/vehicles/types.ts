/**
 * Vehicle definition = pure data. Physics, render mesh and audio are all
 * generated from it, so a new car is a new data file (+ optional plugin).
 */
import type { EngineSpec } from '../physics/vehicle/engine.ts'
import type { GearboxSpec } from '../physics/vehicle/gearbox.ts'
import type { TyreSpec } from '../physics/vehicle/tyre.ts'
import type { ParamDef } from '../core/params.ts'

/** One cross-section of the body lattice along the vehicle's length (z). */
export interface BodyStation {
  z: number // m, +z = front
  halfWidth: number
  floorY: number
  beltY: number // window line
  /** Roof height; omit for open sections (hood / trunk). */
  roofY?: number
  /** Roof half width (tumblehome). Defaults to 0.85·halfWidth. */
  roofHalfWidth?: number
}

export interface BodyMaterial {
  nodeMass: number // kg per node (scaled to hit target mass)
  spring: number
  damp: number
  yieldStrain: number
  breakStrain: number
}

export interface WheelDef {
  id: string
  /** Body-local, +x = left. */
  x: number
  y: number
  z: number
  steer: boolean
  driven: boolean
  brakeTorque: number // Nm max
}

export interface SuspensionDef {
  spring: number // N/m
  damperBump: number // N·s/m
  damperRebound: number
  travel: number // m
  antiRoll: number // N/m equivalent
}

export interface VehicleDef {
  id: string
  name: string
  mass: number // kg target
  stations: readonly BodyStation[]
  body: BodyMaterial
  wheels: readonly WheelDef[]
  suspensionFront: SuspensionDef
  suspensionRear: SuspensionDef
  engine: EngineSpec
  gearbox: GearboxSpec
  tyre: TyreSpec
  maxSteer: number // rad
  /** Driver eye position for cockpit camera, body-local design coordinates. */
  eye: readonly [number, number, number]
  color: number
  params: readonly ParamDef[]
}
