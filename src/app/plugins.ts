/**
 * Built-in plugins. Each is self-contained and can be replaced or omitted
 * (snapshot mode skips input/audio). All simulation goes through PhysicsHost
 * (inline or worker); plugins never touch the physics world directly.
 *
 * Fixed step:  0 input → 20 sim (inline: step; worker: push controls)
 * Frame:       0 input actions → 5 sim.sync (pull snapshot, alpha) →
 *              40 audio → 50 camera → 60 render → 90 telemetry
 */
import type { Plugin } from '../core/kernel.ts'
import { InputMapper } from '../input/input.ts'
import type { AudioService } from '../audio/audio.ts'
import { RenderService, type RenderOptions } from '../render/renderer.ts'
import { CameraRig, newPose } from '../render/cameraRig.ts'
import { VehicleView } from '../render/vehicleView.ts'
import { newTelemetry } from '../vehicles/runtime.ts'
import { wallMs } from '../sim/protocol.ts'
import type { PhysicsHost } from '../sim/host.ts'
import { T, type GameEvents, type Telemetry } from './tokens.ts'

type P = Plugin<GameEvents>

export const simPlugin = (host: PhysicsHost): P => ({
  id: 'sim',
  setup(ctx) {
    ctx.provide(T.sim, host)
    ctx.provide(T.vehicle, host.vehicle)
    const off = host.onImpact((strength) => ctx.events.emit('impact', { strength }))
    ctx.events.on('ui:pause', (p) => host.setPaused(p))
    ctx.addSystem({
      id: 'sim',
      order: 20,
      fixedUpdate(dt) {
        const input = ctx.tryGet(T.input)
        if (input) host.setControls(input.controls)
        host.fixedUpdate(dt)
      },
    })
    ctx.addSystem({
      id: 'sim.sync',
      order: 5,
      update(alpha) {
        host.sync(wallMs(), alpha)
      },
      dispose() {
        off()
        host.dispose()
      },
    })
    ctx.events.emit('vehicle:spawned', host.vehicle)
  },
})

export const inputPlugin = (target: Window): P => ({
  id: 'input',
  requires: ['sim'],
  setup(ctx) {
    const input = new InputMapper()
    const host = ctx.get(T.sim)
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
        const f = host.vehicle.frame
        input.update(dt, Math.hypot(f.vx, f.vz))
        if (input.consume('shiftUp')) host.command({ type: 'shift', delta: 1 })
        if (input.consume('shiftDown')) host.command({ type: 'shift', delta: -1 })
        if (input.consume('reset')) {
          host.command({ type: 'reset' })
          ctx.events.emit('vehicle:reset', host.vehicle)
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
  requires: ['sim'],
  setup(ctx) {
    ctx.provide(T.audio, audio)
    const host = ctx.get(T.sim)
    ctx.events.on('impact', ({ strength }) => audio.impact(strength))
    ctx.events.on('ui:pause', (p) => (p ? audio.suspend() : audio.resume()))
    ctx.addSystem({
      id: 'audio',
      order: 40,
      update() {
        const t = host.telemetry
        audio.setEngine({ rpm: t.rpm, load: t.load, throttle: t.throttle })
      },
    })
  },
})

export const renderPlugin = (opts: RenderOptions): P => ({
  id: 'render',
  requires: ['sim'],
  setup(ctx) {
    const render = new RenderService(opts)
    ctx.provide(T.render, render)
    const host = ctx.get(T.sim)
    const v = host.vehicle
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
      update() {
        view.update(v.prevPos, host.alpha, v.frame, v.wheels)
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
  requires: ['sim'],
  setup(ctx) {
    const host = ctx.get(T.sim)
    const tel: Telemetry = {
      ...newTelemetry(),
      fps: 0,
      physicsMs: 0,
      frameMs: 0,
      camera: 'chase',
      drawCalls: 0,
      triangles: 0,
      physicsMode: `${host.kind} · ${host.transport}`,
      stepsPerSec: 0,
      latencyMs: 0,
    }
    ctx.provide(T.telemetry, tel)
    ctx.addSystem({
      id: 'telemetry',
      order: 90,
      update(_a, frameDt) {
        Object.assign(tel, host.telemetry)
        tel.physicsMs = host.stats.physicsMs
        tel.stepsPerSec = host.stats.stepsPerSec
        tel.latencyMs = tel.latencyMs * 0.9 + host.stats.latencyMs * 0.1
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
