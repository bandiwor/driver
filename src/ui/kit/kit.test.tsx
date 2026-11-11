// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render } from 'preact'
import { Button, Gauge, Slider, Toggle, decimalsFor } from './kit.tsx'
import { TuningPanel } from '../screens/TuningPanel.tsx'
import { ParamStore } from '../../core/params.ts'
import { sedan } from '../../vehicles/sedan.ts'
import { ICONS } from '../icons/Icon.tsx'

const mount = (vnode: Parameters<typeof render>[0]): HTMLElement => {
  const el = document.createElement('div')
  document.body.append(el)
  render(vnode, el)
  return el
}

describe('UI kit', () => {
  it('Button fires onClick and renders hotkey', () => {
    const fn = vi.fn()
    const el = mount(<Button onClick={fn} hotkey="R" icon="reset">Сброс</Button>)
    el.querySelector('button')?.click()
    expect(fn).toHaveBeenCalledOnce()
    expect(el.querySelector('kbd')?.textContent).toBe('R')
  })
  it('Slider formats by step and emits numbers', () => {
    const fn = vi.fn()
    const el = mount(<Slider label="X" value={1.5} min={0} max={3} step={0.01} unit="м" onInput={fn} />)
    expect(el.querySelector('output')?.textContent).toBe('1.50 м')
    const input = el.querySelector('input') as HTMLInputElement
    input.value = '2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(fn).toHaveBeenCalledWith(2)
    expect(decimalsFor(500)).toBe(0)
  })
  it('Slider shows reset only when changed from default', () => {
    const fn = vi.fn()
    const el = mount(<Slider label="X" value={2} defaultValue={1} min={0} max={3} step={1} onInput={fn} />)
    el.querySelector<HTMLButtonElement>('.k-slider__reset')?.click()
    expect(fn).toHaveBeenCalledWith(1)
  })
  it('Toggle reports checked state', () => {
    const fn = vi.fn()
    const el = mount(<Toggle label="T" checked={false} onChange={fn} />)
    el.querySelector('input')?.click()
    expect(fn).toHaveBeenCalledWith(true)
  })
  it('Gauge exposes an accessible meter', () => {
    const el = mount(<Gauge value={3000} max={8000} redline={6800} label="RPM" center="3" />)
    const svg = el.querySelector('svg[role=meter]')
    expect(svg?.getAttribute('aria-valuenow')).toBe('3000')
  })
  it('icons are valid path strings', () => {
    for (const d of Object.values(ICONS)) expect(d).toMatch(/^M[\d.\s,MLHVCSQTAZmlhvcsqtaz-]+$/)
  })
})

describe('TuningPanel', () => {
  it('renders a slider per param of the active group and writes to the store', () => {
    const store = new ParamStore(sedan.params)
    const el = mount(<TuningPanel params={store} />)
    const first = sedan.params[0]!
    const inGroup = sedan.params.filter((p) => p.group === first.group)
    expect(el.querySelectorAll('.k-slider')).toHaveLength(inGroup.length)
    const input = el.querySelector('input') as HTMLInputElement
    input.value = String(first.min)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(store.get(first.id)).toBe(first.min)
    expect(el.querySelectorAll('[role=tab]')).toHaveLength(store.groups().length)
  })
})
