/**
 * Built-in plugins. Each is self-contained and can be replaced or omitted
 * (tests use physics+vehicle only; snapshot mode skips input/audio).
 * System order: 0 input → 10 vehicle pre → 20 physics → 30 vehicle post →
 * 40 audio → 50 camera → 60 render → 90 telemetry.
 */
import type { Plugin } from '../core/kernel.ts'
import { PhysicsWorld } from '../physics/softbody/world.ts'
import { FlatGround } from '../physics/softbody/ground.ts'
import { Vehicle, newTelemetry } from '../vehicles/runtime.ts'
import { getVehicle } from '../vehicles/registry.ts'
import { InputMapper } from '../input/input.ts'
import type { AudioService } from '../audio/audio.ts'
import { RenderService, type RenderOptions } from '../render/renderer.ts'
import { CameraRig, newPose } from '../render/cameraRig.ts'
import { VehicleView } from '../render/vehicleView.ts'
import { T, type GameEvents, type Telemetry } from './tokens.ts'

type P = Plugin<GameEvents>

export const physicsPlugin = (substeps = 16): P => ({
  id: 'physics',
  setup(ctx) {
    const world = new PhysicsWorld(new FlatGround(0), { substeps })
    ctx.provide(T.world, world)
    ctx.addSystem({
      id: 'physics',
      order: 20,
      fixedUpdate(dt) {
        const t0 = performance.now()
        world.step(dt)
        const tel = ctx.tryGet(T.telemetry)
        if (tel) tel.physicsMs = tel.physicsMs * 0.9 + (performance.now() - t0) * 0.1
        if (world.stats.broken > 0) ctx.events.emit('impact', { strength: Math.min(1, world.stats.broken / 8) })
      },
    })
  },
})

export const vehiclePlugin = (vehicleId: string): P => ({
  id: 'vehicle',
  requires: ['physics'],
  setup(ctx) {
    const world = ctx.get(T.world)
    const v = new Vehicle(getVehicle(vehicleId), [0, 0.05, 0])
    world.add(v.body)
    ctx.provide(T.vehicle, v)
    const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, clutch: 0 }
    ctx.addSystem({
      id: 'vehicle.pre',
      order: 10,
      fixedUpdate(dt) {
        v.preStep(dt, ctx.tryGet(T.input)?.controls ?? idle)
      },
    })
    ctx.addSystem({ id: 'vehicle.post', order: 30, fixedUpdate: () => v.postStep() })
    ctx.events.emit('vehicle:spawned', v)
  },
})

export const inputPlugin = (target: Window): P => ({
  id: 'input',
  setup(ctx) {
    const input = new InputMapper()
    ctx.provide(T.input, input)
    const down = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return
      if (input.keyDown(e.code)) e.preventDefault()
    }
    const up = (e: KeyboardEvent): void => void input.keyUp(e.code)
    const blur = (): void => input.clear()
    target.addEventListener('keydown', down)
    target.addEventListener('keyup', up)
    target.addEventListener('blur', blur)
    ctx.addSystem({
      id: 'input',
      order: 0,
      fixedUpdate(dt) {
        const v = ctx.tryGet(T.vehicle)
        input.update(dt, v ? Math.hypot(v.frame.vx, v.frame.vz) : 0)
        if (v) {
          if (input.consume('shiftUp')) v.shift(1)
          if (input.consume('shiftDown')) v.shift(-1)
          if (input.consume('reset')) {
            v.reset()
            ctx.events.emit('vehicle:reset', v)
          }
        }
      },
      update() {
        // Discrete UI actions are polled per frame (work while paused too).
        if (input.consume('camera')) ctx.events.emit('camera:mode', ctx.get(T.camera).cycle())
        if (input.consume('pause')) ctx.events.emit('ui:pause', !ctx.get(T.loop).paused)
        if (input.consume('tuning')) ctx.events.emit('ui:tuning', true)
        if (input.consume('debug')) ctx.events.emit('debug:toggle', undefined)
      },
      dispose() {
        target.removeEventListener('keydown', down)
        target.removeEventListener('keyup', up)
        target.removeEventListener('blur', blur)
      },
    })
  },
})

export const audioPlugin = (audio: AudioService): P => ({
  id: 'audio',
  requires: ['vehicle'],
  setup(ctx) {
    ctx.provide(T.audio, audio)
    const v = ctx.get(T.vehicle)
    ctx.events.on('impact', ({ strength }) => audio.impact(strength))
    ctx.events.on('ui:pause', (p) => (p ? audio.suspend() : audio.resume()))
    ctx.addSystem({
      id: 'audio',
      order: 40,
      update() {
        audio.setEngine({ rpm: v.telemetry(scratch).rpm, load: v.engine.load, throttle: v.engine.throttle })
      },
    })
  },
})
const scratch = newTelemetry()

export const renderPlugin = (opts: RenderOptions): P => ({
  id: 'render',
  requires: ['vehicle'],
  setup(ctx) {
    const render = new RenderService(opts)
    ctx.provide(T.render, render)
    const v = ctx.get(T.vehicle)
    const view = new VehicleView(v.def, v.vb)
    render.scene.add(view.root)
    ctx.provide(T.vehicleView, view)
    const rig = new CameraRig({ eye: v.frameLocal(v.def.eye), chaseDistance: 6.2, chaseHeight: 2.1, topHeight: 22 })
    ctx.provide(T.camera, rig)
    const pose = newPose()
    ctx.events.on('debug:toggle', () => (view.showBeams = !view.showBeams))
    ctx.addSystem({
      id: 'camera',
      order: 50,
      update(_alpha, frameDt) {
        rig.update(v.frame, frameDt, pose)
        render.applyPose(pose)
        render.env.follow(v.frame.px, 0, v.frame.pz)
      },
    })
    ctx.addSystem({
      id: 'render',
      order: 60,
      update(alpha) {
        view.update(v.prevPos, alpha, v.frame)
        render.render()
      },
      dispose: () => {
        view.dispose()
        render.dispose()
      },
    })
  },
})

export const telemetryPlugin = (): P => ({
  id: 'telemetry',
  requires: ['vehicle'],
  setup(ctx) {
    const tel: Telemetry = { ...newTelemetry(), fps: 0, physicsMs: 0, frameMs: 0, camera: 'chase', drawCalls: 0, triangles: 0 }
    ctx.provide(T.telemetry, tel)
    const v = ctx.get(T.vehicle)
    ctx.addSystem({
      id: 'telemetry',
      order: 90,
      update(_a, frameDt) {
        v.telemetry(tel)
        tel.frameMs = tel.frameMs * 0.9 + frameDt * 1000 * 0.1
        tel.fps = tel.frameMs > 0 ? 1000 / tel.frameMs : 0
        const cam = ctx.tryGet(T.camera)
        if (cam) tel.camera = cam.mode
        const r = ctx.tryGet(T.render)
        if (r) {
          const i = r.info
          tel.drawCalls = i.calls
          tel.triangles = i.triangles
        }
      },
    })
  },
})
