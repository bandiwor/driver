/**
 * Vehicle definition = pure data. Physics, render mesh and audio are all
 * generated from it, so a new car is a new data file (+ optional plugin).
 */
import type { EngineSpec } from '../physics/vehicle/engine.ts'
import type { GearboxSpec } from '../physics/vehicle/gearbox.ts'
import type { TyreSpec } from '../physics/vehicle/tyre.ts'
import type { EngineModuleDef } from '../physics/vehicle/powerplant.ts'
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
  /**
   * Structural strength multiplier (spring and yield). Omitted → derived:
   * end sections crumple (0.5), cabin (roofed) sections form a cage (1.6).
   */
  strength?: number
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
  /** Wheel centre, body-local design coordinates; +x = left. */
  x: number
  y: number
  z: number
  axle: 'front' | 'rear'
  steer: boolean
  /** Max brake torque at the default brake bias, Nm. */
  brakeTorque: number
}

export interface SuspensionDef {
  spring: number // N/m
  damperBump: number // N·s/m
  damperRebound: number
  /** Compression travel from design ride height, m. */
  travel: number
  /** Droop (extension) travel from design ride height, m. */
  droop: number
  antiRoll: number // N/m of left-right compression difference
  /** Lower-arm length (hub → inner pivot), m. */
  armLength: number
  /** Strut top mount height above the hub, m. */
  strutHeight: number
  /** Static camber (rad, negative = top inward) and toe (rad, + = toe-in). */
  camber: number
  toe: number
}

export interface DrivetrainDef {
  /** Share of drive torque to the front axle: 0 RWD, 1 FWD, between = AWD. */
  frontSplit: number
  /** Axle diff locking 0 (open) … 1 (locked). */
  diffLock: number
  /** Automatic gearbox by default. */
  automatic: boolean
}

/** Engine voice character for the procedural synth (see audio/dsp/engineSynth.ts). */
export interface EngineSoundDef {
  /** Exhaust resonance centre frequencies, Hz (low = deep). */
  resonances: readonly number[]
  /** Per-cylinder firing irregularity 0..0.12 (V8 burble ↑). */
  irregularity: number
  gain: number
}

export interface VehicleDef {
  id: string
  name: string
  /** Short body/drive description for the garage (e.g. "Хэтчбек · передний привод"). */
  description: string
  sound: EngineSoundDef
  mass: number // kg target (total, incl. unsprung)
  stations: readonly BodyStation[]
  body: BodyMaterial
  wheels: readonly WheelDef[]
  wheelMass: number // unsprung mass per corner, kg
  wheelInertia: number // kg·m²
  handbrakeTorque: number // Nm per rear wheel
  suspensionFront: SuspensionDef
  suspensionRear: SuspensionDef
  drivetrain: DrivetrainDef
  engine: EngineSpec
  /** Combustion pipeline modules (fuel, ignition, exhaust, turbo, …). */
  powerplant: readonly EngineModuleDef[]
  /** Tailpipe tips, body-local design coordinates (exhaust points backwards, −z). */
  exhausts: readonly (readonly [number, number, number])[]
  gearbox: GearboxSpec
  tyre: TyreSpec
  maxSteer: number // rad
  /** 0 = parallel steer, 1 = full Ackermann. */
  ackermann: number
  /** Drag area Cd·A, m². */
  dragArea: number
  /** Driver eye position for cockpit camera, body-local design coordinates. */
  eye: readonly [number, number, number]
  color: number
  params: readonly ParamDef[]
}
