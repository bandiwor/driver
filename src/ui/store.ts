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

export const tel = {
  speed: signal(0),
  rpm: signal(0),
  gear: signal('N'),
  damage: signal(0),
  limiter: signal(false),
  fps: signal(0),
  physicsMs: signal(0),
  drawCalls: signal(0),
  triangles: signal(0),
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
  reset(): void
  dispose(): void
}

export function bindGame(game: Game, sampleHz = 15): GameBridge {
  const k = game.kernel
  const v = k.get(T.vehicle)
  const t: Telemetry = k.get(T.telemetry)
  const offs: (() => void)[] = []
  offs.push(k.events.on('camera:mode', (m) => (cameraMode.value = m)))
  offs.push(k.events.on('ui:pause', (p) => (paused.value = p)))
  offs.push(k.events.on('ui:tuning', () => (tuningOpen.value = !tuningOpen.value)))
  offs.push(k.events.on('debug:toggle', () => (debugOverlay.value = !debugOverlay.value)))
  offs.push(v.params.subscribe(() => paramsVersion.value++))
  const timer = setInterval(() => {
    batch(() => {
      tel.speed.value = Math.round(t.speedKmh)
      tel.rpm.value = Math.round(t.rpm / 10) * 10
      tel.gear.value = t.gear
      tel.damage.value = t.damage
      tel.limiter.value = t.limiter
      tel.fps.value = Math.round(t.fps)
      tel.physicsMs.value = Math.round(t.physicsMs * 100) / 100
      tel.drawCalls.value = t.drawCalls
      tel.triangles.value = t.triangles
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
    reset() {
      v.reset()
      k.events.emit('vehicle:reset', v)
    },
    dispose() {
      clearInterval(timer)
      for (const o of offs) o()
    },
  }
}
