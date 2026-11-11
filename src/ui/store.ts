/**
 * UI state (Preact signals). The game never imports this; `bindGame()`
 * bridges kernel events + telemetry into signals. Telemetry is sampled at
 * ~15 Hz so the 60–144 Hz render loop never triggers VDOM work.
 */
import { batch, computed, signal } from '@preact/signals'
import type { CameraMode } from '../render/cameraRig.ts'
import type { Game } from '../app/game.ts'
import { T, type Telemetry } from '../app/tokens.ts'
import type { ParamStore } from '../core/params.ts'

export type Screen = 'menu' | 'drive'

export const screen = signal<Screen>('menu')
export const paused = signal(false)
export const tuningOpen = signal(false)
export const helpOpen = signal(false)
export const debugOverlay = signal(false)
export const cameraMode = signal<CameraMode>('chase')
export const volume = signal(0.7)
export const showBeams = signal(false)

export type Transmission = 'auto' | 'manual'
/** Chosen in the main menu; mirrored from the vehicle's `gear.auto` param. */
export const transmission = signal<Transmission>('auto')

export const tel = {
  speed: signal(0),
  rpm: signal(0),
  gear: signal('N'),
  damage: signal(0),
  limiter: signal(false),
  running: signal(true),
  clutch: signal(1),
  automatic: signal(true),
  grind: signal(false),
  fps: signal(0),
  physicsMs: signal(0),
  drawCalls: signal(0),
  triangles: signal(0),
  physicsMode: signal(''),
  stepsPerSec: signal(0),
  latencyMs: signal(0),
}
export const damagePct = computed(() => Math.min(100, tel.damage.value * 2000))

/** Bumped whenever a param changes, so the tuning panel re-reads values. */
export const paramsVersion = signal(0)

export interface GameBridge {
  game: Game
  params: ParamStore
  redline: number
  maxRpm: number
  setPaused(p: boolean): void
  setCamera(m: CameraMode): void
  setBeams(on: boolean): void
  setTransmission(t: Transmission): void
  reset(): void
  dispose(): void
}

export function bindGame(game: Game, sampleHz = 15): GameBridge {
  const k = game.kernel
  const host = game.host
  const v = host.vehicle
  const t: Telemetry = k.get(T.telemetry)
  const offs: (() => void)[] = []
  offs.push(k.events.on('camera:mode', (m) => (cameraMode.value = m)))
  offs.push(k.events.on('ui:pause', (p) => (paused.value = p)))
  offs.push(k.events.on('ui:tuning', () => (tuningOpen.value = !tuningOpen.value)))
  offs.push(k.events.on('debug:toggle', () => (debugOverlay.value = !debugOverlay.value)))
  offs.push(
    v.params.subscribe((id, value) => {
      paramsVersion.value++
      if (id === 'gear.auto') transmission.value = value >= 0.5 ? 'auto' : 'manual'
    }),
  )
  // Apply the menu choice to the freshly created vehicle.
  v.params.set('gear.auto', transmission.value === 'auto' ? 1 : 0)
  const timer = setInterval(() => {
    batch(() => {
      tel.speed.value = Math.round(t.speedKmh)
      tel.rpm.value = Math.round(t.rpm / 10) * 10
      tel.gear.value = t.gear
      tel.damage.value = t.damage
      tel.limiter.value = t.limiter
      tel.running.value = t.running
      tel.clutch.value = Math.round(t.clutch * 20) / 20
      tel.automatic.value = t.automatic
      tel.grind.value = t.grind
      tel.fps.value = Math.round(t.fps)
      tel.physicsMs.value = Math.round(t.physicsMs * 100) / 100
      tel.drawCalls.value = t.drawCalls
      tel.triangles.value = t.triangles
      tel.physicsMode.value = t.physicsMode
      tel.stepsPerSec.value = Math.round(t.stepsPerSec)
      tel.latencyMs.value = Math.round(t.latencyMs * 10) / 10
    })
  }, 1000 / sampleHz)
  return {
    game,
    params: v.params,
    redline: v.engineSpec.redlineRpm,
    maxRpm: Math.ceil((v.engineSpec.limiterRpm + 1000) / 1000) * 1000,
    setPaused: (p) => k.events.emit('ui:pause', p),
    setCamera(m) {
      k.get(T.camera).mode = m
      k.events.emit('camera:mode', m)
    },
    setBeams(on) {
      k.get(T.vehicleView).showBeams = on
      showBeams.value = on
    },
    setTransmission(mode) {
      transmission.value = mode
      v.params.set('gear.auto', mode === 'auto' ? 1 : 0)
    },
    reset() {
      host.command({ type: 'reset' })
      k.events.emit('vehicle:reset', v)
    },
    dispose() {
      clearInterval(timer)
      for (const o of offs) o()
    },
  }
}
