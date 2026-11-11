import type { JSX } from 'preact'
import { Button, Panel, Slider, Toggle } from '../kit/kit.tsx'
import { cameraMode, showBeams, volume } from '../store.ts'
import { CAMERA_MODES, type CameraMode } from '../../render/cameraRig.ts'
import { ControlsList } from './MainMenu.tsx'

const LABELS: Readonly<Record<CameraMode, string>> = { chase: 'Сзади', cockpit: 'Салон', top: 'Сверху', orbit: 'Орбита' }

export interface PauseMenuProps {
  onResume: () => void
  onReset: () => void
  onTuning: () => void
  onExit: () => void
  onVolume: (v: number) => void
  onCamera: (m: CameraMode) => void
  onBeams: (on: boolean) => void
}

export function PauseMenu(p: PauseMenuProps): JSX.Element {
  return (
    <div class="k-scrim">
      <div class="k-pause">
        <Panel title="Пауза" icon="pause">
          <div class="k-stack">
            <Button variant="primary" icon="play" onClick={p.onResume} hotkey="Esc">
              Продолжить
            </Button>
            <Button icon="reset" onClick={p.onReset} hotkey="R">
              Сбросить машину
            </Button>
            <Button icon="wrench" onClick={p.onTuning} hotkey="T">
              Настройка
            </Button>
            <Button icon="exit" variant="ghost" onClick={p.onExit}>
              В меню
            </Button>
          </div>
        </Panel>
        <Panel title="Параметры" icon="gear">
          <Slider label="Громкость" value={volume.value} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onInput={p.onVolume} />
          <div class="k-segment" role="radiogroup" aria-label="Камера">
            {CAMERA_MODES.map((m) => (
              <button type="button" role="radio" aria-checked={cameraMode.value === m} class={cameraMode.value === m ? 'is-active' : ''} onClick={() => p.onCamera(m)}>
                {LABELS[m]}
              </button>
            ))}
          </div>
          <Toggle label="Показать балки (F3)" checked={showBeams.value} onChange={p.onBeams} />
        </Panel>
        <Panel title="Управление" icon="keyboard">
          <ControlsList />
        </Panel>
      </div>
    </div>
  )
}
