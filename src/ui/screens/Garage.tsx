/** Vehicle picker: cards with an SVG side silhouette generated from the body stations. */
import type { JSX } from 'preact'
import { listVehicles } from '../../vehicles/registry.ts'
import { silhouettePath, vehicleSpecs } from '../../vehicles/specs.ts'
import type { VehicleDef } from '../../vehicles/types.ts'

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`
const DRIVE: Readonly<Record<'RWD' | 'FWD' | 'AWD', string>> = { RWD: 'Задний', FWD: 'Передний', AWD: 'Полный' }

export function Silhouette({ def, height = 44 }: { def: VehicleDef; height?: number }): JSX.Element {
  const { d, wheels, viewBox } = silhouettePath(def)
  return (
    <svg class="k-silhouette" viewBox={viewBox} height={height} aria-hidden="true" preserveAspectRatio="xMidYMax meet">
      <path d={d} fill={hex(def.color)} />
      {wheels.map((w) => (
        <circle cx={w.cx} cy={w.cy} r={w.r} class="k-silhouette__wheel" />
      ))}
    </svg>
  )
}

export interface GarageProps {
  selected: string
  onSelect: (id: string) => void
}

export function GarageList({ selected, onSelect }: GarageProps): JSX.Element {
  return (
    <div class="k-garage" role="radiogroup" aria-label="Машина">
      {listVehicles().map((v) => {
        const s = vehicleSpecs(v)
        return (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={v.id === selected}
            class={`k-garage__item ${v.id === selected ? 'is-active' : ''}`}
            onClick={() => onSelect(v.id)}
          >
            <Silhouette def={v} />
            <span class="k-garage__name">{v.name}</span>
            <span class="k-garage__meta">
              {s.powerKw} кВт · {DRIVE[s.drive]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function VehicleSheet({ def }: { def: VehicleDef }): JSX.Element {
  const s = vehicleSpecs(def)
  const rows: [string, string][] = [
    ['Мощность', `${s.powerKw} кВт · ${Math.round(s.powerKw * 1.36)} л.с.`],
    ['Момент', `${s.torqueNm} Н·м`],
    ['Двигатель', `${s.engine}${s.turbo ? ' турбо' : ''}`],
    ['Привод', DRIVE[s.drive]],
    ['Масса', `${s.massKg} кг`],
    ['Удельная', `${s.powerToWeight} кВт/т`],
    ['Передач', String(s.gears)],
  ]
  return (
    <div class="k-sheet">
      <Silhouette def={def} height={84} />
      <p class="k-muted">{def.description}</p>
      <dl class="k-sheet__specs">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
