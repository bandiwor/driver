import type { VehicleDef } from './types.ts'
import { sedan } from './sedan.ts'
import { coupe, hatch, pickup, rally } from './catalog.ts'

/** Vehicle catalogue (garage order). Mods/plugins call `registerVehicle`. */
const vehicles = new Map<string, VehicleDef>([sedan, hatch, coupe, pickup, rally].map((v) => [v.id, v]))

export const registerVehicle = (v: VehicleDef): void => {
  if (vehicles.has(v.id)) throw new Error(`Vehicle "${v.id}" already registered`)
  vehicles.set(v.id, v)
}
export const getVehicle = (id: string): VehicleDef => {
  const v = vehicles.get(id)
  if (!v) throw new Error(`Unknown vehicle "${id}"`)
  return v
}
export const hasVehicle = (id: string): boolean => vehicles.has(id)
export const listVehicles = (): VehicleDef[] => [...vehicles.values()]
