/** Service tokens + global event map. The contract between plugins. */
import { token } from '../core/kernel.ts'
import type { FixedStepLoop } from '../core/loop.ts'
import type { PhysicsWorld } from '../physics/softbody/world.ts'
import type { Vehicle, VehicleTelemetry } from '../vehicles/runtime.ts'
import type { InputMapper } from '../input/input.ts'
import type { AudioService } from '../audio/audio.ts'
import type { RenderService } from '../render/renderer.ts'
import type { CameraRig, CameraMode } from '../render/cameraRig.ts'
import type { VehicleView } from '../render/vehicleView.ts'

export type GameEvents = {
  'vehicle:spawned': Vehicle
  'vehicle:reset': Vehicle
  'camera:mode': CameraMode
  'ui:pause': boolean
  'ui:tuning': boolean
  'debug:toggle': undefined
  impact: { strength: number }
}

export interface Telemetry extends VehicleTelemetry {
  fps: number
  physicsMs: number
  frameMs: number
  camera: CameraMode
  drawCalls: number
  triangles: number
}

export const T = {
  loop: token<FixedStepLoop>('loop'),
  world: token<PhysicsWorld>('world'),
  vehicle: token<Vehicle>('vehicle'),
  input: token<InputMapper>('input'),
  audio: token<AudioService>('audio'),
  render: token<RenderService>('render'),
  camera: token<CameraRig>('camera'),
  vehicleView: token<VehicleView>('vehicleView'),
  telemetry: token<Telemetry>('telemetry'),
} as const
