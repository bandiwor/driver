import type { JSX } from 'preact'
import { Button, Kbd, Panel, Segmented } from '../kit/kit.tsx'
import { getVehicle } from '../../vehicles/registry.ts'
import { mapId, transmission, vehicleId, type Transmission } from '../store.ts'
import { listMaps } from '../../world/maps/registry.ts'
import { GarageList, VehicleSheet } from './Garage.tsx'

export const TRANSMISSIONS: readonly { id: Transmission; label: string }[] = [
  { id: 'auto', label: 'Автомат' },
  { id: 'manual', label: 'Механика' },
]

export const CONTROLS: readonly (readonly [string, string])[] = [
  ['W / ↑', 'Газ'],
  ['S / ↓', 'Тормоз · в автомате стоя — назад'],
  ['A D / ← →', 'Руль'],
  ['Space', 'Ручник'],
  ['Shift', 'Сцепление (отпускается плавно)'],
  ['Q / E', 'Передача −/+ (механика)'],
  ['I', 'Стартер (удерживать)'],
  ['C', 'Камера · мышь — вращение, колесо — зум'],
  ['R', 'Сброс машины'],
  ['T', 'Настройка'],
  ['Esc', 'Пауза'],
  ['F3', 'Отладка'],
]

export function ControlsList(): JSX.Element {
  return (
    <dl class="k-controls">
      {CONTROLS.map(([k, v]) => (
        <div class="k-controls__row" key={k}>
          <dt>
            <Kbd>{k}</Kbd>
          </dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

const TRANSMISSION_HINT: Readonly<Record<Transmission, string>> = {
  auto: 'Передачи и сцепление — автоматически. Заглохнуть нельзя.',
  manual: 'Сам выжимаешь сцепление и включаешь передачи. Бросишь сцепление на холостых или тронешься с высокой — заглохнешь.',
}

export interface MainMenuProps {
  onStart: () => void
  onTransmission: (t: Transmission) => void
  onVehicle: (id: string) => void
  onMap: (id: string) => void
  loading: boolean
}

export function MainMenu({ onStart, onTransmission, onVehicle, onMap, loading }: MainMenuProps): JSX.Element {
  const maps = listMaps()
  const map = maps.find((m) => m.id === mapId.value) ?? maps[0]
  const car = getVehicle(vehicleId.value)
  return (
    <div class="k-menu k-menu--garage">
      <div class="k-menu__brand">
        <svg class="k-logo" viewBox="0 0 64 64" aria-hidden="true">
          <path d="M8 40l8-14h32l8 14v6H8z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" />
          <path d="M22 26l5-9h10l5 9" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round" />
          <circle cx="20" cy="46" r="5" fill="currentColor" />
          <circle cx="44" cy="46" r="5" fill="currentColor" />
        </svg>
        <div>
          <h1 class="k-menu__title">KUZOV</h1>
          <p class="k-menu__tag">Песочница мягкой физики</p>
        </div>
      </div>
      <div class="k-menu__grid">
        <Panel title="Гараж" icon="car">
          <GarageList selected={car.id} onSelect={onVehicle} />
        </Panel>
        <Panel title={car.name} icon="engine">
          <VehicleSheet def={car} />
          <p class="k-field-label">Карта</p>
          <Segmented label="Карта" options={maps.map((m) => ({ id: m.id, label: m.name }))} value={map?.id ?? ''} onChange={onMap} />
          <p class="k-muted">{map?.description}</p>
          <p class="k-field-label">Коробка передач</p>
          <Segmented label="Коробка передач" options={TRANSMISSIONS} value={transmission.value} onChange={onTransmission} />
          <p class="k-muted k-hint">{TRANSMISSION_HINT[transmission.value]}</p>
          <Button variant="primary" size="lg" icon="play" onClick={onStart} disabled={loading}>
            {loading ? 'Загрузка…' : 'Поехали'}
          </Button>
        </Panel>
        <Panel title="Управление" icon="keyboard">
          <ControlsList />
        </Panel>
      </div>
    </div>
  )
}
