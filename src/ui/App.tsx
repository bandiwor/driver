/** Root UI. Owns game lifecycle (lazy-created on "Drive"). */
import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { createGame, type PhysicsMode } from '../app/game.ts'
import { WebAudio, type AudioService } from '../audio/audio.ts'
import { getVehicle, hasVehicle } from '../vehicles/registry.ts'
import { voiceFor } from '../audio/dsp/engineSynth.ts'
import { bindGame, paused, screen, transmission, tuningOpen, vehicleId, volume, type GameBridge, type Transmission } from './store.ts'
import { MainMenu } from './screens/MainMenu.tsx'
import { Hud } from './screens/Hud.tsx'
import { TuningPanel } from './screens/TuningPanel.tsx'
import { PauseMenu } from './screens/PauseMenu.tsx'

export interface AppProps {
  canvas: HTMLCanvasElement
  vehicleId: string
  physics: PhysicsMode
}

const makeAudio = (id: string): AudioService => {
  const def = getVehicle(id)
  return new WebAudio(voiceFor(def.engine.cylinders, def.sound))
}

export function App({ canvas, vehicleId: initialVehicle, physics }: AppProps): JSX.Element {
  const [bridge, setBridge] = useState<GameBridge | null>(null)
  const [audio, setAudio] = useState<AudioService | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (hasVehicle(initialVehicle)) vehicleId.value = initialVehicle
  }, [initialVehicle])
  useEffect(() => () => bridge?.game.dispose(), [bridge])

  const start = async (): Promise<void> => {
    const id = vehicleId.value
    if (bridge && bridge.vehicleId === id) {
      screen.value = 'drive'
      bridge.setPaused(false)
      return
    }
    // A different car: tear down the old game + audio graph, build a new one.
    if (bridge) {
      bridge.dispose()
      bridge.game.dispose()
      setBridge(null)
    }
    audio?.dispose()
    setLoading(true)
    const sound = makeAudio(id)
    setAudio(sound)
    // Never let audio block the game: give it a few seconds, then go silent.
    await Promise.race([sound.init(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]).catch(
      (e: unknown) => console.warn('Audio unavailable', e),
    )
    sound.setMasterVolume(volume.value)
    const game = await createGame({ canvas, vehicleId: id, audio: sound, physics })
    const b = bindGame(game)
    setBridge(b)
    game.start()
    screen.value = 'drive'
    setLoading(false)
    canvas.focus()
  }

  const setTransmission = (t: Transmission): void => {
    if (bridge) bridge.setTransmission(t)
    else transmission.value = t
  }

  if (screen.value === 'menu' || !bridge)
    return (
      <MainMenu
        onStart={() => void start()}
        onTransmission={setTransmission}
        onVehicle={(id) => (vehicleId.value = id)}
        loading={loading}
      />
    )

  return (
    <>
      <Hud redline={bridge.redline} maxRpm={bridge.maxRpm} />
      {tuningOpen.value && <TuningPanel params={bridge.params} onClose={() => (tuningOpen.value = false)} />}
      {paused.value && (
        <PauseMenu
          onResume={() => bridge.setPaused(false)}
          onReset={() => {
            bridge.reset()
            bridge.setPaused(false)
          }}
          onTuning={() => {
            tuningOpen.value = true
            bridge.setPaused(false)
          }}
          onExit={() => {
            bridge.setPaused(true)
            screen.value = 'menu'
          }}
          onVolume={(v) => {
            volume.value = v
            audio?.setMasterVolume(v)
          }}
          onCamera={(m) => bridge.setCamera(m)}
          onBeams={(on) => bridge.setBeams(on)}
          onTransmission={setTransmission}
        />
      )}
    </>
  )
}
