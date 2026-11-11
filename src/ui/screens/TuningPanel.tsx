/** Auto-generated tuning UI: one tab per param group, one slider per param. */
import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { ParamStore } from '../../core/params.ts'
import { Button, Panel, Slider, Tabs } from '../kit/kit.tsx'
import type { IconName } from '../icons/Icon.tsx'
import { paramsVersion } from '../store.ts'

const GROUP_ICONS: Readonly<Record<string, IconName>> = {
  Подвеска: 'spring',
  Трансмиссия: 'gear',
  Двигатель: 'engine',
  Шины: 'tyre',
  Тормоза: 'brake',
  Кузов: 'body',
}

export interface TuningPanelProps {
  params: ParamStore
  onClose?: () => void
}

export function TuningPanel({ params, onClose }: TuningPanelProps): JSX.Element {
  const groups = params.groups()
  const [group, setGroup] = useState(groups[0] ?? '')
  void paramsVersion.value // subscribe to param changes
  return (
    <Panel
      title="Настройка"
      icon="wrench"
      class="k-tuning"
      actions={
        <>
          <Button size="sm" variant="ghost" icon="reset" title="Сбросить всё" onClick={() => params.reset()} />
          {onClose && <Button size="sm" variant="ghost" icon="close" title="Закрыть (T)" onClick={onClose} />}
        </>
      }
    >
      <Tabs tabs={groups.map((g) => ({ id: g, label: g, ...(GROUP_ICONS[g] ? { icon: GROUP_ICONS[g] } : {}) }))} active={group} onChange={setGroup} />
      <div class="k-tuning__list">
        {params.defs
          .filter((d) => d.group === group)
          .map((d) => (
            <Slider
              key={d.id}
              label={d.label}
              value={params.get(d.id)}
              min={d.min}
              max={d.max}
              step={d.step}
              unit={d.unit}
              hint={d.hint}
              defaultValue={d.default}
              onInput={(v) => params.set(d.id, v)}
            />
          ))}
      </div>
    </Panel>
  )
}
