import { describe, expect, it } from 'vitest'
import { cityPoint } from './cities'

describe('cityPoint', () => {
  it('maps known cities into the plot bounds', () => {
    const k = cityPoint('Karachi')
    const l = cityPoint('Lahore')
    const i = cityPoint('Islamabad')
    for (const p of [k, l, i]) {
      expect(p).not.toBeNull()
      expect(p!.x).toBeGreaterThanOrEqual(0)
      expect(p!.x).toBeLessThanOrEqual(1)
      expect(p!.y).toBeGreaterThanOrEqual(0)
      expect(p!.y).toBeLessThanOrEqual(1)
    }
    expect(k!.y).toBeGreaterThan(l!.y)
    expect(l!.x).toBeGreaterThan(k!.x)
    expect(i!.y).toBeLessThan(l!.y)
  })

  it('is case and whitespace insensitive', () => {
    expect(cityPoint('  lahore ')).toEqual(cityPoint('Lahore'))
    expect(cityPoint('KARACHI')).toEqual(cityPoint('Karachi'))
    expect(cityPoint('Rahim   Yar Khan')).toEqual(cityPoint('Rahim yar khan'))
  })

  it('returns null for unknown cities', () => {
    expect(cityPoint('Atlantis')).toBeNull()
    expect(cityPoint(null)).toBeNull()
    expect(cityPoint('')).toBeNull()
  })
})
