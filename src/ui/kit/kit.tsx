/**
 * Kuzov UI kit. Small, dependency-free primitives. Rules (docs/STYLE.md):
 * one accent colour, 4px grid, every control keyboard-accessible, values in
 * mono tabular digits, no layout shift on value change.
 */
import type { ComponentChildren, JSX } from 'preact'
import { useId } from 'preact/hooks'
import { Icon, type IconName } from '../icons/Icon.tsx'

const cx = (...c: (string | false | undefined | null)[]): string => c.filter(Boolean).join(' ')

export interface ButtonProps {
  children?: ComponentChildren
  icon?: IconName
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  title?: string
  hotkey?: string
  onClick?: () => void
  class?: string
}

export function Button(p: ButtonProps): JSX.Element {
  return (
    <button
      type="button"
      class={cx('k-btn', `k-btn--${p.variant ?? 'secondary'}`, `k-btn--${p.size ?? 'md'}`, !p.children && 'k-btn--icon', p.class)}
      disabled={p.disabled}
      title={p.title}
      onClick={p.onClick}
    >
      {p.icon && <Icon name={p.icon} size={p.size === 'lg' ? 22 : 18} />}
      {p.children && <span class="k-btn__label">{p.children}</span>}
      {p.hotkey && <Kbd>{p.hotkey}</Kbd>}
    </button>
  )
}

export function Kbd({ children }: { children: ComponentChildren }): JSX.Element {
  return <kbd class="k-kbd">{children}</kbd>
}

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string | undefined
  hint?: string | undefined
  defaultValue?: number
  format?: (v: number) => string
  onInput: (v: number) => void
}

export const decimalsFor = (step: number): number => {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

export function Slider(p: SliderProps): JSX.Element {
  const id = useId()
  const fmt = p.format ?? ((v: number) => v.toFixed(decimalsFor(p.step)))
  const pct = ((p.value - p.min) / (p.max - p.min)) * 100
  const changed = p.defaultValue !== undefined && p.value !== p.defaultValue
  return (
    <div class={cx('k-slider', changed && 'k-slider--changed')}>
      <div class="k-slider__head">
        <label for={id} class="k-slider__label" title={p.hint}>
          {p.label}
        </label>
        <output for={id} class="k-slider__value">
          {fmt(p.value)}
          {p.unit && <span class="k-slider__unit"> {p.unit}</span>}
        </output>
        {changed && (
          <button type="button" class="k-slider__reset" title="Сбросить" onClick={() => p.onInput(p.defaultValue ?? p.value)}>
            <Icon name="reset" size={14} />
          </button>
        )}
      </div>
      <input
        id={id}
        class="k-slider__input"
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        style={{ '--k-pct': `${pct}%` }}
        onInput={(e) => p.onInput(Number(e.currentTarget.value))}
      />
    </div>
  )
}

export interface ToggleProps {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}

export function Toggle(p: ToggleProps): JSX.Element {
  return (
    <label class="k-toggle">
      <input type="checkbox" role="switch" checked={p.checked} onChange={(e) => p.onChange(e.currentTarget.checked)} />
      <span class="k-toggle__track" aria-hidden="true">
        <span class="k-toggle__thumb" />
      </span>
      <span class="k-toggle__label">{p.label}</span>
    </label>
  )
}

export interface TabsProps<T extends string> {
  tabs: readonly { id: T; label: string; icon?: IconName }[]
  active: T
  onChange: (id: T) => void
}

export function Tabs<T extends string>(p: TabsProps<T>): JSX.Element {
  return (
    <div class="k-tabs" role="tablist">
      {p.tabs.map((t) => (
        <button
          type="button"
          role="tab"
          aria-selected={t.id === p.active}
          class={cx('k-tab', t.id === p.active && 'k-tab--active')}
          onClick={() => p.onChange(t.id)}
        >
          {t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
        </button>
      ))}
    </div>
  )
}

export interface SegmentedProps<T extends string> {
  label: string
  options: readonly { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}

/** Single-choice segmented control (radio group). */
export function Segmented<T extends string>(p: SegmentedProps<T>): JSX.Element {
  return (
    <div class="k-segment" role="radiogroup" aria-label={p.label} style={{ '--k-n': String(p.options.length) }}>
      {p.options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={p.value === o.id}
          class={p.value === o.id ? 'is-active' : ''}
          onClick={() => p.onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface PanelProps {
  title?: string
  icon?: IconName
  actions?: ComponentChildren
  children?: ComponentChildren
  class?: string
}

export function Panel(p: PanelProps): JSX.Element {
  return (
    <section class={cx('k-panel', p.class)}>
      {(p.title || p.actions) && (
        <header class="k-panel__head">
          {p.icon && <Icon name={p.icon} size={18} />}
          {p.title && <h2 class="k-panel__title">{p.title}</h2>}
          <div class="k-panel__actions">{p.actions}</div>
        </header>
      )}
      <div class="k-panel__body">{p.children}</div>
    </section>
  )
}

export function Stat({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: 'ok' | 'warn' | 'danger' }): JSX.Element {
  return (
    <div class={cx('k-stat', tone && `k-stat--${tone}`)}>
      <span class="k-stat__value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      <span class="k-stat__label">{label}</span>
    </div>
  )
}

export interface GaugeProps {
  value: number
  max: number
  redline: number
  label: string
  center: string
  sub?: string
  size?: number
}

const polar = (deg: number, rad: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [100 + Math.cos(a) * rad, 100 + Math.sin(a) * rad]
}

/** Arc gauge (tachometer). 240° sweep, ticks every 1000, redline zone. */
export function Gauge(p: GaugeProps): JSX.Element {
  const size = p.size ?? 180
  const r = 76
  const sweep = 240
  const start = 150
  const arc = (from: number, to: number, rad: number): string => {
    const [x0, y0] = polar(start + sweep * from, rad)
    const [x1, y1] = polar(start + sweep * to, rad)
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${rad} ${rad} 0 ${sweep * (to - from) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
  }
  const t = Math.min(1, Math.max(0, p.value / p.max))
  const red = p.redline / p.max
  const ticks: JSX.Element[] = []
  for (let v = 0; v <= p.max; v += 1000) {
    const f = v / p.max
    const [x0, y0] = polar(start + sweep * f, r - 4)
    const [x1, y1] = polar(start + sweep * f, r - 14)
    ticks.push(<line x1={x0} y1={y0} x2={x1} y2={y1} class={f >= red ? 'k-gauge__tick k-gauge__tick--red' : 'k-gauge__tick'} />)
  }
  const [nx, ny] = polar(start + sweep * t, r - 18)
  return (
    <svg class="k-gauge" width={size} height={size} viewBox="0 0 200 200" role="meter" aria-label={p.label} aria-valuenow={Math.round(p.value)} aria-valuemin={0} aria-valuemax={p.max}>
      <path d={arc(0, 1, r)} class="k-gauge__track" />
      <path d={arc(red, 1, r)} class="k-gauge__red" />
      {t > 0.001 && <path d={arc(0, t, r)} class={t >= red ? 'k-gauge__fill k-gauge__fill--red' : 'k-gauge__fill'} />}
      {ticks}
      <line x1={100} y1={100} x2={nx} y2={ny} class="k-gauge__needle" />
      <circle cx={100} cy={100} r={5} class="k-gauge__hub" />
      <text x={100} y={140} class="k-gauge__center">{p.center}</text>
      {p.sub && <text x={100} y={160} class="k-gauge__sub">{p.sub}</text>}
    </svg>
  )
}
