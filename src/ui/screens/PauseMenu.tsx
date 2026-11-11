import type { JSX } from 'preact'
import { Button, Panel, Segmented, Slider, Toggle } from '../kit/kit.tsx'
import { cameraMode, showBeams, transmission, volume, type Transmission } from '../store.ts'
import { CAMERA_MODES, type CameraMode } from '../../render/cameraRig.ts'
import { CAMERA_LABELS } from './Hud.tsx'
import { ControlsList, TRANSMISSIONS } from './MainMenu.tsx'

export interface PauseMenuProps {
  onResume: () => void
  onReset: () => void
  onTuning: () => void
  onExit: () => void
  onVolume: (v: number) => void
  onCamera: (m: CameraMode) => void
  onBeams: (on: boolean) => void
  onTransmission: (t: Transmission) => void
  spawns: readonly { id: string; name: string }[]
  onTeleport: (spawn: string) => void
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
          <p class="k-field-label">Камера</p>
          <Segmented
            label="Камера"
            options={CAMERA_MODES.map((m) => ({ id: m, label: CAMERA_LABELS[m].label }))}
            value={cameraMode.value}
            onChange={p.onCamera}
          />
          <p class="k-field-label">Коробка передач</p>
          <Segmented label="Коробка передач" options={TRANSMISSIONS} value={transmission.value} onChange={p.onTransmission} />
          <Toggle label="Показать балки (F3)" checked={showBeams.value} onChange={p.onBeams} />
        </Panel>
        <Panel title="Точки карты" icon="top">
          <div class="k-stack">
            {p.spawns.map((s) => (
              <Button key={s.id} size="sm" icon="chevronRight" onClick={() => p.onTeleport(s.id)}>
                {s.name}
              </Button>
            ))}
          </div>
        </Panel>
        <Panel title="Управление" icon="keyboard">
          <ControlsList />
        </Panel>
      </div>
    </div>
  )
}
