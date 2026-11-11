/** Garage-facing specs derived from a vehicle definition (pure, tested). */
import { RPM_TO_RADS } from '../core/math/scalar.ts'
import { sample } from '../physics/vehicle/curve.ts'
import type { VehicleDef } from './types.ts'

export interface VehicleSpecs {
  powerKw: number
  powerRpm: number
  torqueNm: number
  massKg: number
  /** kW per tonne. */
  powerToWeight: number
  drive: 'RWD' | 'FWD' | 'AWD'
  engine: string
  turbo: boolean
  gears: number
}

export function vehicleSpecs(def: VehicleDef): VehicleSpecs {
  const e = def.engine
  let powerKw = 0
  let powerRpm = 0
  let torqueNm = 0
  for (let rpm = 500; rpm <= e.limiterRpm; rpm += 50) {
    const t = sample(e.torqueCurve, rpm)
    const p = (t * rpm * RPM_TO_RADS) / 1000
    if (p > powerKw) {
      powerKw = p
      powerRpm = rpm
    }
    torqueNm = Math.max(torqueNm, t)
  }
  const turbo = def.powerplant.find((m) => m.kind === 'turbo')
  const hasTurbo = turbo?.kind === 'turbo' && turbo.enabled
  if (hasTurbo) {
    // Wastegate boost multiplies the charge (see powerplant pipeline).
    powerKw *= 1 + turbo.boost
    torqueNm *= 1 + turbo.boost
  }
  const split = def.drivetrain.frontSplit
  const cyl = e.cylinders
  return {
    powerKw: Math.round(powerKw),
    powerRpm,
    torqueNm: Math.round(torqueNm),
    massKg: def.mass,
    powerToWeight: Math.round((powerKw / def.mass) * 1000),
    drive: split <= 0 ? 'RWD' : split >= 1 ? 'FWD' : 'AWD',
    engine: `${cyl >= 8 ? 'V' : 'R'}${cyl}`,
    turbo: hasTurbo,
    gears: def.gearbox.ratios.length,
  }
}

/**
 * Side-profile silhouette (SVG path, +z forward → right) from the body
 * stations: upper outline (roof/belt) forward→back, then floor back→forward.
 * Coordinates in metres, y up flipped for SVG.
 */
export function silhouettePath(def: VehicleDef): { d: string; wheels: { cx: number; cy: number; r: number }[]; viewBox: string } {
  const st = [...def.stations].sort((a, b) => b.z - a.z)
  const top = st.map((s) => [s.z, s.roofY ?? s.beltY] as const)
  const bottom = st.toReversed().map((s) => [s.z, s.floorY] as const)
  const pts = [...top, ...bottom]
  const zs = pts.map((p) => p[0])
  const minZ = Math.min(...zs) - 0.1
  const maxZ = Math.max(...zs) + 0.1
  const maxY = Math.max(...pts.map((p) => p[1])) + 0.1
  const X = (z: number): number => +(z - minZ).toFixed(3) // shift so min z → 0
  const Y = (y: number): number => +(maxY - y).toFixed(3)
  const d = `M${pts.map(([z, y]) => `${X(z)} ${Y(y)}`).join('L')}Z`
  const wheels = def.wheels
    .filter((w) => w.x > 0)
    .map((w) => ({ cx: X(w.z), cy: Y(w.y), r: def.tyre.radius }))
  return { d, wheels, viewBox: `0 0 ${(maxZ - minZ).toFixed(3)} ${maxY.toFixed(3)}` }
}
