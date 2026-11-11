/** Root UI. Owns game lifecycle (lazy-created on "Drive"). */
import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { createGame, type PhysicsMode } from '../app/game.ts'
import { WebAudio, type AudioService } from '../audio/audio.ts'
import { getVehicle } from '../vehicles/registry.ts'
import { bindGame, paused, screen, tuningOpen, volume, type GameBridge } from './store.ts'
import { MainMenu } from './screens/MainMenu.tsx'
import { Hud } from './screens/Hud.tsx'
import { TuningPanel } from './screens/TuningPanel.tsx'
import { PauseMenu } from './screens/PauseMenu.tsx'

export interface AppProps {
  canvas: HTMLCanvasElement
  vehicleId: string
  physics: PhysicsMode
}

export function App({ canvas, vehicleId, physics }: AppProps): JSX.Element {
  const [bridge, setBridge] = useState<GameBridge | null>(null)
  const [audio] = useState<AudioService>(() => new WebAudio(getVehicle(vehicleId).engine.cylinders))
  const [loading, setLoading] = useState(false)

  useEffect(() => () => bridge?.game.dispose(), [bridge])

  const start = async (): Promise<void> => {
    if (bridge) {
      screen.value = 'drive'
      bridge.setPaused(false)
      return
    }
    setLoading(true)
    await audio.init().catch((e: unknown) => console.warn('Audio unavailable', e))
    audio.setMasterVolume(volume.value)
    const game = await createGame({ canvas, vehicleId, audio, physics })
    const b = bindGame(game)
    setBridge(b)
    game.start()
    screen.value = 'drive'
    setLoading(false)
    canvas.focus()
  }

  if (screen.value === 'menu' || !bridge) return <MainMenu onStart={() => void start()} loading={loading} />

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
            audio.setMasterVolume(v)
          }}
          onCamera={(m) => bridge.setCamera(m)}
          onBeams={(on) => bridge.setBeams(on)}
        />
      )}
    </>
  )
}
