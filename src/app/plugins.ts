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
import { CameraRig, newPose, type CameraMode } from '../render/cameraRig.ts'
import { VehicleView } from '../render/vehicleView.ts'
import { VehicleEffects, tyreSmokeIntensity } from '../render/effects.ts'
import { newTelemetry } from '../vehicles/runtime.ts'
import { wallMs } from '../sim/protocol.ts'
import type { PhysicsHost } from '../sim/host.ts'
import type { World } from '../world/map.ts'
import { WorldView } from '../render/worldView.ts'
import { T, type GameEvents, type Telemetry } from './tokens.ts'

type P = Plugin<GameEvents>

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'])

/** Only real text entry keeps keys away from the game (sliders/toggles/buttons don't). */
export const isTextField = (t: EventTarget | null): boolean =>
  t instanceof HTMLTextAreaElement ||
  t instanceof HTMLSelectElement ||
  (t instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(t.type)) ||
  (t instanceof HTMLElement && t.isContentEditable)

export const simPlugin = (host: PhysicsHost, world: World): P => ({
  id: 'sim',
  setup(ctx) {
    ctx.provide(T.sim, host)
    ctx.provide(T.world, world)
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
      if (isTextField(e.target)) return
      if (!input.keyDown(e.code)) return
      // Game keys win over focused UI controls: no slider moves on arrows,
      // no button "clicks" on Space; focus goes back to the game.
      e.preventDefault()
      const el = document.activeElement
      if (el instanceof HTMLElement && el !== document.body && el.tagName !== 'CANVAS') el.blur()
    }
    const up = (e: KeyboardEvent): void => {
      // Always release, even inside a text field, so no key gets stuck.
      if (input.keyUp(e.code) && !isTextField(e.target)) e.preventDefault()
    }
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
    let pops = -1
    let bovs = -1
    ctx.addSystem({
      id: 'audio',
      order: 40,
      update() {
        const t = host.telemetry
        audio.setEngine({ rpm: t.rpm, load: t.load, throttle: t.throttle })
        audio.setTurbo(t.turbo ? t.turboSpin : 0, t.boost)
        // Event counters are monotonic: play every pop/blow-off that happened since last frame.
        if (pops < 0) pops = t.afterfires
        if (bovs < 0) bovs = t.blowOffs
        for (let i = Math.min(4, t.afterfires - pops); i > 0; i--) audio.afterfire(t.afterfireStrength)
        if (t.blowOffs > bovs) audio.blowOff(host.vehicle.params.get('turbo.blowOff') >= 0.5)
        pops = t.afterfires
        bovs = t.blowOffs
        let squeal = 0
        const v = host.vehicle
        for (let i = 0; i < v.wheels.length; i++) {
          const w = v.wheels[i]!
          squeal = Math.max(squeal, tyreSmokeIntensity(w.slipSpeed * 1.4, w.load, v.chassis.nominalLoad[i]!))
        }
        audio.setTyres(squeal)
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
    const worldView = new WorldView(ctx.get(T.world), render.renderer.capabilities.getMaxAnisotropy())
    render.scene.add(worldView.root)
    const view = new VehicleView(v.def, v.vb)
    render.scene.add(view.root)
    ctx.provide(T.vehicleView, view)
    const effects = new VehicleEffects(v, host.telemetry)
    render.scene.add(effects.group)
    ctx.provide(T.effects, effects)
    ctx.events.on('vehicle:reset', () => effects.clear())
    const rig = new CameraRig({ eye: v.frameLocal(v.def.eye), chaseDistance: 6.2, chaseHeight: 2.1, topHeight: 22 })
    ctx.provide(T.camera, rig)
    const pose = newPose()
    ctx.events.on('debug:toggle', () => (view.showBeams = !view.showBeams))
    const offPointer = bindCameraPointer(opts.canvas, rig, (m) => ctx.events.emit('camera:mode', m))
    ctx.addSystem({
      id: 'camera',
      order: 50,
      update(_alpha, frameDt) {
        rig.update(v.frame, frameDt, pose)
        render.applyPose(pose)
        render.env.follow(v.frame.px, v.frame.py, v.frame.pz)
      },
    })
    ctx.addSystem({
      id: 'render',
      order: 60,
      update(_alpha, frameDt) {
        view.update(v.prevPos, host.alpha, v.frame, v.wheels)
        // Particles freeze with the game when paused.
        effects.update(ctx.get(T.loop).paused ? 0 : Math.min(frameDt, 0.1))
        render.render()
      },
      dispose: () => {
        offPointer()
        effects.dispose()
        worldView.dispose()
        view.dispose()
        render.dispose()
      },
    })
  },
})

/**
 * Mouse camera control on the canvas: drag (any button) rotates — free
 * camera orbit, cockpit look-around; wheel zooms; double-click recentres the
 * cockpit look. Pointer capture keeps the drag alive outside the canvas.
 */
const ctxMenu = (e: Event): void => e.preventDefault()

export function bindCameraPointer(canvas: HTMLCanvasElement, rig: CameraRig, onMode: (m: CameraMode) => void): () => void {
  const RAD_PER_PX = 0.006
  let dragging = -1
  let lx = 0
  let ly = 0
  const down = (e: PointerEvent): void => {
    dragging = e.pointerId
    lx = e.clientX
    ly = e.clientY
    canvas.setPointerCapture(e.pointerId)
  }
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== dragging) return
    const before = rig.mode
    rig.rotate((e.clientX - lx) * RAD_PER_PX, (e.clientY - ly) * RAD_PER_PX)
    lx = e.clientX
    ly = e.clientY
    if (rig.mode !== before) onMode(rig.mode)
  }
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== dragging) return
    dragging = -1
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  }
  const wheel = (e: WheelEvent): void => {
    e.preventDefault()
    // Pixel/line/page deltas → a smooth exponential zoom.
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY
    rig.zoom(Math.exp(Math.max(-200, Math.min(200, px)) * 0.0015))
  }
  const dbl = (): void => rig.resetLook()
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)
  canvas.addEventListener('wheel', wheel, { passive: false })
  canvas.addEventListener('dblclick', dbl)
  canvas.addEventListener('contextmenu', ctxMenu)
  canvas.style.touchAction = 'none'
  return () => {
    canvas.removeEventListener('pointerdown', down)
    canvas.removeEventListener('pointermove', move)
    canvas.removeEventListener('pointerup', up)
    canvas.removeEventListener('pointercancel', up)
    canvas.removeEventListener('wheel', wheel)
    canvas.removeEventListener('dblclick', dbl)
    canvas.removeEventListener('contextmenu', ctxMenu)
  }
}

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
      particles: 0,
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
        const fx = ctx.tryGet(T.effects)
        if (fx) tel.particles = fx.smoke.state.live + fx.fire.state.live
      },
    })
  },
})
