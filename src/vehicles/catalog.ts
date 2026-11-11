/**
 * Vehicle catalogue beyond the reference sedan. All original designs.
 *
 * Suspension is derived physically, not hand-tweaked: spring rate from the
 * corner's sprung mass and a target ride frequency, damping as a fraction of
 * critical — so heavy and light cars feel "right" relative to each other.
 */
import { curve } from '../physics/vehicle/curve.ts'
import type { EngineSpec } from '../physics/vehicle/engine.ts'
import type { TyreSpec } from '../physics/vehicle/tyre.ts'
import { defineVehicle } from './params.ts'
import type { SuspensionDef } from './types.ts'

const deg = Math.PI / 180

/** Engine spec with sensible defaults for the stall/starter model. */
const engine = (e: Partial<EngineSpec> & Pick<EngineSpec, 'torqueCurve' | 'idleRpm' | 'redlineRpm' | 'limiterRpm' | 'cylinders'>): EngineSpec => ({
  inertia: 0.15,
  frictionTorque: 11,
  frictionCoef: 0.022,
  brakingTorque: 40,
  stallRpm: e.idleRpm * 0.47,
  crankRpm: 180,
  pushStartRpm: e.idleRpm * 0.76,
  starterTorque: 110,
  starterMaxRpm: 320,
  crankTime: 0.55,
  idleControlMax: 0.3,
  ...e,
})

const tyre = (t: Partial<TyreSpec> & Pick<TyreSpec, 'radius' | 'width'>): TyreSpec => ({
  B: 10,
  C: 1.9,
  D: 1.05,
  E: 0.97,
  lateralScale: 1,
  rollingResistance: 0.012,
  loadSensitivity: 0.12,
  radialStiffness: 240000,
  radialDamping: 600,
  relaxationLength: 0.25,
  camberStiffness: 0.6,
  pressure: 230,
  ...t,
})

const r = (v: number, s: number): number => Math.round(v / s) * s

/**
 * Corner suspension from physics: k = m·(2πf)², c = 2ζ·√(k·m).
 * @param mass       total vehicle mass, kg
 * @param axleShare  fraction of weight on this axle
 * @param unsprung   unsprung mass per corner, kg
 * @param hz         ride frequency (1.2 soft … 2.2 stiff)
 * @param zeta       damping ratio for bump (rebound ≈ 1.45× bump)
 */
function corner(
  mass: number,
  axleShare: number,
  unsprung: number,
  hz: number,
  zeta: number,
  rest: Omit<SuspensionDef, 'spring' | 'damperBump' | 'damperRebound'>,
): SuspensionDef {
  const m = (mass * axleShare) / 2 - unsprung
  const k = m * (2 * Math.PI * hz) ** 2
  const cBump = 2 * zeta * Math.sqrt(k * m)
  return { spring: r(k, 500), damperBump: r(cBump, 100), damperRebound: r(cBump * 1.45, 100), ...rest }
}

// ─── Kuzov Piccolo — city hatchback, FWD, 1.6 i4 ───────────────────────
const HATCH_MASS = 1050
export const hatch = defineVehicle({
  id: 'k2-hatch',
  name: 'Kuzov Piccolo',
  description: 'Хэтчбек · передний привод · рядная четвёрка',
  sound: { resonances: [150, 430, 1250], irregularity: 0.02, gain: 0.52 },
  mass: HATCH_MASS,
  color: 0x2f8fd8,
  stations: [
    { z: 1.85, halfWidth: 0.76, floorY: 0.3, beltY: 0.6 },
    { z: 1.3, halfWidth: 0.82, floorY: 0.26, beltY: 0.74 },
    { z: 0.7, halfWidth: 0.84, floorY: 0.24, beltY: 0.84 },
    { z: 0.05, halfWidth: 0.85, floorY: 0.24, beltY: 0.9, roofY: 1.44, roofHalfWidth: 0.7 },
    { z: -1.12, halfWidth: 0.85, floorY: 0.26, beltY: 0.92, roofY: 1.42, roofHalfWidth: 0.7 },
    { z: -1.5, halfWidth: 0.83, floorY: 0.3, beltY: 0.9 },
    { z: -1.66, halfWidth: 0.8, floorY: 0.34, beltY: 0.82 },
  ],
  body: { nodeMass: 25, spring: 2.2e6, damp: 550, yieldStrain: 0.04, breakStrain: 0.35 },
  wheels: [
    { id: 'FL', x: 0.72, y: 0.29, z: 1.25, axle: 'front', steer: true, brakeTorque: 1700 },
    { id: 'FR', x: -0.72, y: 0.29, z: 1.25, axle: 'front', steer: true, brakeTorque: 1700 },
    { id: 'RL', x: 0.72, y: 0.29, z: -1.15, axle: 'rear', steer: false, brakeTorque: 850 },
    { id: 'RR', x: -0.72, y: 0.29, z: -1.15, axle: 'rear', steer: false, brakeTorque: 850 },
  ],
  wheelMass: 30,
  wheelInertia: 0.8,
  handbrakeTorque: 1800,
  suspensionFront: corner(HATCH_MASS, 0.62, 30, 1.65, 0.3, {
    travel: 0.09,
    droop: 0.1,
    antiRoll: 14000,
    armLength: 0.4,
    strutHeight: 0.42,
    camber: -1 * deg,
    toe: 0.1 * deg,
  }),
  suspensionRear: corner(HATCH_MASS, 0.38, 30, 1.8, 0.3, {
    travel: 0.1,
    droop: 0.1,
    antiRoll: 4000,
    armLength: 0.4,
    strutHeight: 0.4,
    camber: -1.2 * deg,
    toe: 0.15 * deg,
  }),
  drivetrain: { frontSplit: 1, diffLock: 0, automatic: true },
  engine: engine({
    torqueCurve: curve([
      [0, 0],
      [800, 95],
      [2000, 130],
      [3500, 148],
      [4500, 155],
      [6000, 142],
      [6800, 122],
      [7200, 100],
    ]),
    idleRpm: 850,
    redlineRpm: 6500,
    limiterRpm: 6800,
    inertia: 0.12,
    frictionTorque: 9,
    frictionCoef: 0.018,
    brakingTorque: 30,
    cylinders: 4,
  }),
  powerplant: [
    { kind: 'fuel', lambda: 0.9, overrun: 0.05 },
    { kind: 'ignition', timing: 0 },
    { kind: 'exhaust', popSensitivity: 0.8 },
    { kind: 'turbo', enabled: false, boost: 0.7, size: 0.8, blowOff: true, antiLag: false },
  ],
  exhausts: [[-0.38, 0.27, -1.68]],
  gearbox: { ratios: [3.45, 1.95, 1.32, 1.03, 0.82], reverse: 3.3, finalDrive: 4.06, shiftTime: 0.24, clutchMaxTorque: 330 },
  tyre: tyre({ radius: 0.29, width: 0.185, D: 1.0 }),
  maxSteer: 36 * deg,
  ackermann: 0.8,
  dragArea: 0.62,
  eye: [0.36, 1.14, -0.15],
})

// ─── Kuzov Strela — sports coupe, RWD, turbo i6 ────────────────────────
const COUPE_MASS = 1320
export const coupe = defineVehicle({
  id: 'k3-coupe',
  name: 'Kuzov Strela',
  description: 'Спорт-купе · задний привод · турбо-шестёрка',
  sound: { resonances: [120, 380, 1050], irregularity: 0.025, gain: 0.66 },
  mass: COUPE_MASS,
  color: 0x1fa36b,
  stations: [
    { z: 2.25, halfWidth: 0.8, floorY: 0.22, beltY: 0.52 },
    { z: 1.55, halfWidth: 0.9, floorY: 0.2, beltY: 0.66 },
    { z: 0.7, halfWidth: 0.92, floorY: 0.2, beltY: 0.78 },
    { z: 0.05, halfWidth: 0.93, floorY: 0.2, beltY: 0.82, roofY: 1.2, roofHalfWidth: 0.68 },
    { z: -0.7, halfWidth: 0.93, floorY: 0.2, beltY: 0.84, roofY: 1.17, roofHalfWidth: 0.66 },
    { z: -1.55, halfWidth: 0.92, floorY: 0.22, beltY: 0.84 },
    { z: -2.2, halfWidth: 0.86, floorY: 0.26, beltY: 0.8 },
  ],
  body: { nodeMass: 30, spring: 2.8e6, damp: 650, yieldStrain: 0.045, breakStrain: 0.35 },
  wheels: [
    { id: 'FL', x: 0.8, y: 0.33, z: 1.4, axle: 'front', steer: true, brakeTorque: 3000 },
    { id: 'FR', x: -0.8, y: 0.33, z: 1.4, axle: 'front', steer: true, brakeTorque: 3000 },
    { id: 'RL', x: 0.8, y: 0.33, z: -1.3, axle: 'rear', steer: false, brakeTorque: 2000 },
    { id: 'RR', x: -0.8, y: 0.33, z: -1.3, axle: 'rear', steer: false, brakeTorque: 2000 },
  ],
  wheelMass: 36,
  wheelInertia: 1.2,
  handbrakeTorque: 2600,
  suspensionFront: corner(COUPE_MASS, 0.52, 36, 2.1, 0.34, {
    travel: 0.07,
    droop: 0.08,
    antiRoll: 22000,
    armLength: 0.44,
    strutHeight: 0.4,
    camber: -2 * deg,
    toe: 0.05 * deg,
  }),
  suspensionRear: corner(COUPE_MASS, 0.48, 36, 2.2, 0.34, {
    travel: 0.07,
    droop: 0.08,
    antiRoll: 12000,
    armLength: 0.44,
    strutHeight: 0.4,
    camber: -1.5 * deg,
    toe: 0.2 * deg,
  }),
  drivetrain: { frontSplit: 0, diffLock: 0.45, automatic: true },
  engine: engine({
    torqueCurve: curve([
      [0, 0],
      [800, 140],
      [2000, 230],
      [3500, 300],
      [5000, 320],
      [6500, 300],
      [7300, 260],
      [7800, 200],
    ]),
    idleRpm: 900,
    redlineRpm: 7200,
    limiterRpm: 7500,
    inertia: 0.16,
    frictionTorque: 12,
    brakingTorque: 48,
    cylinders: 6,
  }),
  powerplant: [
    { kind: 'fuel', lambda: 0.86, overrun: 0.35 },
    { kind: 'ignition', timing: 0 },
    { kind: 'exhaust', popSensitivity: 1.2 },
    { kind: 'turbo', enabled: true, boost: 0.8, size: 1.1, blowOff: true, antiLag: false },
  ],
  exhausts: [
    [0.2, 0.2, -2.22],
    [-0.2, 0.2, -2.22],
  ],
  gearbox: { ratios: [3.3, 2.1, 1.5, 1.18, 0.95, 0.79], reverse: 3.2, finalDrive: 3.62, shiftTime: 0.15, clutchMaxTorque: 650 },
  tyre: tyre({ radius: 0.33, width: 0.255, D: 1.15, B: 11 }),
  maxSteer: 32 * deg,
  ackermann: 0.7,
  dragArea: 0.6,
  eye: [0.38, 0.98, -0.3],
})

// ─── Kuzov Burlak — full-size pickup, 4×4, V8 ──────────────────────────
const PICKUP_MASS = 2050
export const pickup = defineVehicle({
  id: 'k4-pickup',
  name: 'Kuzov Burlak',
  description: 'Пикап · полный привод · V8',
  sound: { resonances: [70, 210, 640], irregularity: 0.09, gain: 0.78 },
  mass: PICKUP_MASS,
  color: 0x6b7f8f,
  stations: [
    { z: 2.55, halfWidth: 0.9, floorY: 0.55, beltY: 0.95 },
    { z: 1.85, halfWidth: 0.98, floorY: 0.52, beltY: 1.12 },
    { z: 1.1, halfWidth: 1.0, floorY: 0.5, beltY: 1.2 },
    { z: 0.45, halfWidth: 1.0, floorY: 0.5, beltY: 1.25, roofY: 1.85, roofHalfWidth: 0.86 },
    { z: -0.45, halfWidth: 1.0, floorY: 0.5, beltY: 1.25, roofY: 1.85, roofHalfWidth: 0.86 },
    // Cab back wall: a near-coincident open station gives a vertical rear window.
    { z: -0.52, halfWidth: 1.0, floorY: 0.5, beltY: 1.25 },
    { z: -1.6, halfWidth: 1.0, floorY: 0.55, beltY: 1.15 },
    { z: -2.65, halfWidth: 0.98, floorY: 0.6, beltY: 1.1 },
  ],
  body: { nodeMass: 40, spring: 3.2e6, damp: 800, yieldStrain: 0.05, breakStrain: 0.38 },
  wheels: [
    { id: 'FL', x: 0.86, y: 0.4, z: 1.75, axle: 'front', steer: true, brakeTorque: 3800 },
    { id: 'FR', x: -0.86, y: 0.4, z: 1.75, axle: 'front', steer: true, brakeTorque: 3800 },
    { id: 'RL', x: 0.86, y: 0.4, z: -1.65, axle: 'rear', steer: false, brakeTorque: 2600 },
    { id: 'RR', x: -0.86, y: 0.4, z: -1.65, axle: 'rear', steer: false, brakeTorque: 2600 },
  ],
  wheelMass: 55,
  wheelInertia: 2.2,
  handbrakeTorque: 3200,
  suspensionFront: corner(PICKUP_MASS, 0.56, 55, 1.3, 0.28, {
    travel: 0.14,
    droop: 0.15,
    antiRoll: 12000,
    armLength: 0.5,
    strutHeight: 0.55,
    camber: -0.3 * deg,
    toe: 0.1 * deg,
  }),
  suspensionRear: corner(PICKUP_MASS, 0.44, 55, 1.45, 0.28, {
    travel: 0.15,
    droop: 0.16,
    antiRoll: 4000,
    armLength: 0.5,
    strutHeight: 0.55,
    camber: 0,
    toe: 0,
  }),
  drivetrain: { frontSplit: 0.4, diffLock: 0.5, automatic: true },
  engine: engine({
    torqueCurve: curve([
      [0, 0],
      [700, 280],
      [1500, 400],
      [2800, 470],
      [3800, 480],
      [4800, 430],
      [5600, 360],
      [6000, 300],
    ]),
    idleRpm: 700,
    redlineRpm: 5400,
    limiterRpm: 5700,
    inertia: 0.32,
    frictionTorque: 20,
    frictionCoef: 0.04,
    brakingTorque: 70,
    cylinders: 8,
    crankRpm: 160,
    starterTorque: 170,
    starterMaxRpm: 280,
    crankTime: 0.7,
  }),
  powerplant: [
    { kind: 'fuel', lambda: 0.86, overrun: 0.1 },
    { kind: 'ignition', timing: 0 },
    { kind: 'exhaust', popSensitivity: 1.1 },
    { kind: 'turbo', enabled: false, boost: 0.6, size: 1.4, blowOff: true, antiLag: false },
  ],
  exhausts: [[-0.82, 0.45, -1.95]],
  gearbox: { ratios: [4.17, 2.34, 1.52, 1.14, 0.87, 0.69], reverse: 3.4, finalDrive: 3.73, shiftTime: 0.3, clutchMaxTorque: 900 },
  tyre: tyre({ radius: 0.4, width: 0.265, D: 0.95, B: 9, radialStiffness: 320000, radialDamping: 900, pressure: 260 }),
  maxSteer: 36 * deg,
  ackermann: 0.9,
  dragArea: 1.1,
  eye: [0.42, 1.62, 0],
})

// ─── Kuzov Vikhr — rally hatch, AWD, turbo i4 with anti-lag ────────────
const RALLY_MASS = 1230
export const rally = defineVehicle({
  id: 'k5-rally',
  name: 'Kuzov Vikhr',
  description: 'Раллийный хэтч · полный привод · турбо + антилаг',
  sound: { resonances: [160, 470, 1450], irregularity: 0.04, gain: 0.7 },
  mass: RALLY_MASS,
  color: 0xf2f2ec,
  stations: [
    { z: 1.95, halfWidth: 0.8, floorY: 0.36, beltY: 0.66 },
    { z: 1.35, halfWidth: 0.88, floorY: 0.32, beltY: 0.8 },
    { z: 0.72, halfWidth: 0.9, floorY: 0.3, beltY: 0.9 },
    { z: 0.05, halfWidth: 0.9, floorY: 0.3, beltY: 0.96, roofY: 1.48, roofHalfWidth: 0.72 },
    { z: -1.15, halfWidth: 0.9, floorY: 0.32, beltY: 0.98, roofY: 1.45, roofHalfWidth: 0.72 },
    { z: -1.55, halfWidth: 0.88, floorY: 0.36, beltY: 0.96 },
    { z: -1.78, halfWidth: 0.84, floorY: 0.4, beltY: 0.9 },
  ],
  body: { nodeMass: 28, spring: 2.6e6, damp: 650, yieldStrain: 0.045, breakStrain: 0.36 },
  wheels: [
    { id: 'FL', x: 0.78, y: 0.32, z: 1.3, axle: 'front', steer: true, brakeTorque: 2600 },
    { id: 'FR', x: -0.78, y: 0.32, z: 1.3, axle: 'front', steer: true, brakeTorque: 2600 },
    { id: 'RL', x: 0.78, y: 0.32, z: -1.2, axle: 'rear', steer: false, brakeTorque: 1700 },
    { id: 'RR', x: -0.78, y: 0.32, z: -1.2, axle: 'rear', steer: false, brakeTorque: 1700 },
  ],
  wheelMass: 34,
  wheelInertia: 1.0,
  handbrakeTorque: 3000,
  suspensionFront: corner(RALLY_MASS, 0.58, 34, 1.75, 0.32, {
    travel: 0.12,
    droop: 0.12,
    antiRoll: 15000,
    armLength: 0.42,
    strutHeight: 0.46,
    camber: -1.5 * deg,
    toe: 0,
  }),
  suspensionRear: corner(RALLY_MASS, 0.42, 34, 1.85, 0.32, {
    travel: 0.12,
    droop: 0.12,
    antiRoll: 9000,
    armLength: 0.42,
    strutHeight: 0.46,
    camber: -1 * deg,
    toe: 0.1 * deg,
  }),
  drivetrain: { frontSplit: 0.45, diffLock: 0.6, automatic: false },
  engine: engine({
    torqueCurve: curve([
      [0, 0],
      [900, 150],
      [2500, 230],
      [4000, 280],
      [5500, 285],
      [6800, 250],
      [7400, 210],
    ]),
    idleRpm: 1000,
    redlineRpm: 7000,
    limiterRpm: 7400,
    inertia: 0.13,
    cylinders: 4,
  }),
  powerplant: [
    { kind: 'fuel', lambda: 0.84, overrun: 0.4 },
    { kind: 'ignition', timing: -2 },
    { kind: 'exhaust', popSensitivity: 1.4 },
    { kind: 'turbo', enabled: true, boost: 1.1, size: 1.2, blowOff: false, antiLag: true },
  ],
  exhausts: [[0.35, 0.3, -1.82]],
  gearbox: { ratios: [3.0, 2.1, 1.6, 1.3, 1.08, 0.92], reverse: 3.1, finalDrive: 4.4, shiftTime: 0.1, clutchMaxTorque: 650 },
  tyre: tyre({ radius: 0.31, width: 0.215, D: 1.1 }),
  maxSteer: 38 * deg,
  ackermann: 0.75,
  dragArea: 0.7,
  eye: [0.38, 1.16, -0.2],
})
