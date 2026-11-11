import type { VehicleDef } from './types.ts'
import { sedan } from './sedan.ts'

/** Vehicle catalogue. Mods/plugins call `registerVehicle`. */
const vehicles = new Map<string, VehicleDef>([[sedan.id, sedan]])

export const registerVehicle = (v: VehicleDef): void => {
  if (vehicles.has(v.id)) throw new Error(`Vehicle "${v.id}" already registered`)
  vehicles.set(v.id, v)
}
export const getVehicle = (id: string): VehicleDef => {
  const v = vehicles.get(id)
  if (!v) throw new Error(`Unknown vehicle "${id}"`)
  return v
}
export const listVehicles = (): VehicleDef[] => [...vehicles.values()]
