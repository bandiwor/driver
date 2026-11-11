import { describe, expect, it } from 'vitest'
import { silhouettePath, vehicleSpecs } from './specs.ts'
import { listVehicles } from './registry.ts'
import { sedan } from './sedan.ts'
import { coupe, pickup } from './catalog.ts'

describe('vehicleSpecs', () => {
  it('derives power, drive and engine layout', () => {
    const s = vehicleSpecs(sedan)
    expect(s.powerKw).toBeGreaterThan(150)
    expect(s.powerKw).toBeLessThan(200)
    expect(s.drive).toBe('RWD')
    expect(s.engine).toBe('R6')
    expect(vehicleSpecs(pickup).engine).toBe('V8')
    expect(vehicleSpecs(pickup).drive).toBe('AWD')
    expect(vehicleSpecs(coupe).turbo).toBe(true)
  })
})

describe('silhouettePath', () => {
  it('produces a closed path within the viewBox for every vehicle', () => {
    for (const v of listVehicles()) {
      const { d, viewBox, wheels } = silhouettePath(v)
      const [, , w, h] = viewBox.split(' ').map(Number)
      const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
      for (let i = 0; i < nums.length; i += 2) {
        expect(nums[i]).toBeGreaterThanOrEqual(0)
        expect(nums[i]).toBeLessThanOrEqual(w!)
        expect(nums[i + 1]).toBeGreaterThanOrEqual(0)
        expect(nums[i + 1]).toBeLessThanOrEqual(h!)
      }
      expect(d.endsWith('Z')).toBe(true)
      expect(wheels).toHaveLength(2)
    }
  })
})
