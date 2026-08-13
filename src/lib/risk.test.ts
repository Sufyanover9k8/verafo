import { describe, expect, it } from 'vitest'
import {
  computeVerdict,
  confidenceFrom,
  formatScore,
  hasEnoughData,
  riskFactors,
  riskLevel,
  toneFromScore,
  RISK,
} from './risk'

describe('computeVerdict', () => {
  it('keeps the grey withheld state only for buyers with zero resolved orders', () => {
    const v = computeVerdict({ risk_score: 0.9, total_orders: 0 })
    expect(v.tone).toBe('unknown')
    expect(v.numeral).toBe('—')
    expect(v.label).toBe('INSUFFICIENT DATA')
    expect(v.short).toBe('INSUFFICIENT')
    expect(v.confidence).toBeNull()
    expect(v.confidenceLabel).toBe('◔ LOW CONFIDENCE')
  })

  it('shows the scored verdict from the first resolved order, flagged low confidence', () => {
    for (const orders of [1, 2]) {
      const v = computeVerdict({ risk_score: 0.9, total_orders: orders })
      expect(v.tone).toBe('high')
      expect(v.numeral).toBe('0.90')
      expect(v.label).toBe('HIGH RISK')
      expect(v.confidence).toBeNull()
      expect(v.confidenceLabel).toBe('◔ LOW CONFIDENCE')
    }
  })

  it('classifies by threshold once enough data exists', () => {
    expect(computeVerdict({ risk_score: 0.2, total_orders: 3 }).tone).toBe('safe')
    expect(computeVerdict({ risk_score: 0.45, total_orders: 3 }).tone).toBe('watch')
    expect(computeVerdict({ risk_score: 0.65, total_orders: 3 }).tone).toBe('watch')
    expect(computeVerdict({ risk_score: 0.66, total_orders: 3 }).tone).toBe('high')
  })

  it('formats the numeral to 2 decimals and labels it', () => {
    const v = computeVerdict({ risk_score: 0.8, total_orders: 3 })
    expect(v.numeral).toBe('0.80')
    expect(v.title).toBe('High risk')
    expect(v.confidence).toBe(0.7)
    expect(v.confidenceLabel).toBe('◐ 70%')
  })

  it('clamps out-of-range scores', () => {
    expect(computeVerdict({ risk_score: 1.5, total_orders: 5 }).tone).toBe('high')
    expect(computeVerdict({ risk_score: -1, total_orders: 5 }).tone).toBe('safe')
  })

  it('treats a missing score as neutral 0.50', () => {
    expect(computeVerdict({ total_orders: 5 }).numeral).toBe('0.50')
  })
})

describe('hasEnoughData / confidenceFrom', () => {
  it('needs at least one resolved order', () => {
    expect(hasEnoughData(0)).toBe(false)
    expect(hasEnoughData(null)).toBe(false)
    expect(hasEnoughData(1)).toBe(true)
    expect(hasEnoughData(3)).toBe(true)
  })

  it('tiers confidence by order volume', () => {
    expect(confidenceFrom(3)).toBe(0.7)
    expect(confidenceFrom(9)).toBe(0.7)
    expect(confidenceFrom(10)).toBe(0.85)
    expect(confidenceFrom(24)).toBe(0.85)
    expect(confidenceFrom(25)).toBe(0.95)
    expect(confidenceFrom(2)).toBeNull()
  })
})

describe('toneFromScore / riskLevel', () => {
  it('maps score bands to tones', () => {
    expect(toneFromScore(0.44)).toBe('safe')
    expect(toneFromScore(0.45)).toBe('watch')
    expect(toneFromScore(0.65)).toBe('watch')
    expect(toneFromScore(0.66)).toBe('high')
  })

  it('riskLevel never returns unknown (legacy surfaces)', () => {
    expect(riskLevel(0.1)).toBe('safe')
    expect(riskLevel(0.5)).toBe('watch')
    expect(riskLevel(0.9)).toBe('high')
  })
})

describe('formatScore', () => {
  it('formats to 2 decimals', () => {
    expect(formatScore(0.123456)).toBe('0.12')
    expect(formatScore(null)).toBe('—')
  })
})

describe('RISK palette', () => {
  it('keys match what riskLevel can return, all with token colours', () => {
    const keys = Object.keys(RISK)
    expect(keys).toEqual(expect.arrayContaining(['safe', 'watch', 'high', 'unknown']))
    for (const level of ['safe', 'watch', 'high', 'unknown'] as const) {
      expect(RISK[level].color).toMatch(/^var\(--v-/)
      expect(RISK[level].bg).toMatch(/^var\(--v-/)
      expect(RISK[level].border).toBeTruthy()
    }
  })
})

describe('riskFactors', () => {
  it('explains the withheld verdict only when nothing has resolved', () => {
    const factors = riskFactors({ total_orders: 0 })
    expect(factors.length).toBe(2)
    expect(factors.every((f) => f.impact === 'none')).toBe(true)
  })

  it('revives early signals from the first resolved order', () => {
    const factors = riskFactors({ total_orders: 1, total_accepted: 1 })
    const labels = factors.map((f) => f.label)
    expect(labels).toContain('Accepted 1 of 1 orders')
    expect(labels).toContain('Only 1 order resolved — early signal')
  })

  it('direction is explicit: refusals raise, acceptances lower', () => {
    const factors = riskFactors({
      total_orders: 5,
      total_refused: 1,
      total_accepted: 4,
      first_seen: new Date(Date.now() - 100 * 86400000).toISOString(),
      orders: [
        { store_id: 'a', address: 'Addr X', ordered_at: new Date().toISOString() },
        { store_id: 'b', address: 'Addr Y', ordered_at: new Date().toISOString() },
      ],
    })
    const byLabel = Object.fromEntries(factors.map((f) => [f.label, f.impact]))
    expect(byLabel).toMatchObject({
      'Refused 1 of 5 orders': 'neg',
      'Accepted 4 of 5 orders': 'pos',
      'Active across 2 connected stores': 'pos',
      'Known to the network for 2+ months': 'pos',
      'New delivery address': 'neg',
    })
  })

  it('omits flourish that the data does not support', () => {
    const factors = riskFactors({ total_orders: 3, total_refused: 3, total_accepted: 0 })
    const labels = factors.map((f) => f.label)
    expect(labels).toContain('Refused 3 of 3 orders')
    expect(labels).not.toContain('Accepted 3 of 3 orders')
  })
})