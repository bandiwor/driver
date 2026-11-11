// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { isTextField } from './plugins.ts'

const input = (type: string): HTMLInputElement => Object.assign(document.createElement('input'), { type })

describe('isTextField', () => {
  it('lets game keys through sliders, toggles and buttons', () => {
    expect(isTextField(input('range'))).toBe(false)
    expect(isTextField(input('checkbox'))).toBe(false)
    expect(isTextField(document.createElement('button'))).toBe(false)
    expect(isTextField(document.body)).toBe(false)
  })
  it('keeps keys inside real text entry', () => {
    expect(isTextField(input('text'))).toBe(true)
    expect(isTextField(input('number'))).toBe(true)
    expect(isTextField(document.createElement('textarea'))).toBe(true)
  })
})
