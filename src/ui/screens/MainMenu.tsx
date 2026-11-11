import type { JSX } from 'preact'
import { Button, Kbd, Panel } from '../kit/kit.tsx'
import { listVehicles } from '../../vehicles/registry.ts'

export const CONTROLS: readonly (readonly [string, string])[] = [
  ['W / ↑', 'Газ'],
  ['S / ↓', 'Тормоз'],
  ['A D / ← →', 'Руль'],
  ['Space', 'Ручник'],
  ['Shift', 'Сцепление'],
  ['Q / E', 'Передача −/+'],
  ['C', 'Камера'],
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

export function MainMenu({ onStart, loading }: { onStart: () => void; loading: boolean }): JSX.Element {
  const car = listVehicles()[0]
  return (
    <div class="k-menu">
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
        <Panel title="Заезд" icon="car">
          <p class="k-menu__car">{car?.name ?? '—'}</p>
          <p class="k-muted">Свободная площадка · деформируемый кузов</p>
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
