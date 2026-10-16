import { describe, expect, it } from 'vitest'
import { bandEvidence, buyerBand } from './risk-score-badge'

describe('buyerBand', () => {
  it('is neutral for a buyer Verafo knows nothing about', () => {
    expect(buyerBand(undefined, undefined)).toBe('neutral')
    expect(buyerBand(null, null)).toBe('neutral')
    // The neutral default 0.5 must never read as a real score.
    expect(buyerBand(0.5, 0)).toBe('neutral')
    expect(buyerBand(0.99, 0)).toBe('neutral')
    expect(buyerBand(0.82, null)).toBe('neutral')
    expect(buyerBand(Number.NaN, 4)).toBe('neutral')
  })

  it('bands a scored buyer by the same thresholds as lib/risk.ts', () => {
    expect(buyerBand(0.1, 5)).toBe('safe')
    expect(buyerBand(0.44, 5)).toBe('safe')
    expect(buyerBand(0.45, 5)).toBe('medium')
    expect(buyerBand(0.65, 5)).toBe('medium')
    expect(buyerBand(0.66, 5)).toBe('high')
    expect(buyerBand(1, 5)).toBe('high')
  })

  it('marks the words provisional until 3 orders have resolved', () => {
    expect(bandEvidence(0.2, 1)).toEqual({ band: 'safe', confident: false })
    expect(bandEvidence(0.2, 2)).toEqual({ band: 'safe', confident: false })
    expect(bandEvidence(0.2, 3)).toEqual({ band: 'safe', confident: true })
    // A risky read is shown immediately, just not asserted as settled.
    expect(bandEvidence(0.9, 1)).toEqual({ band: 'high', confident: false })
    expect(bandEvidence(0.5, 1)).toEqual({ band: 'medium', confident: false })
  })

  it('clamps a score that arrives out of range', () => {
    expect(buyerBand(1.4, 5)).toBe('high')
    expect(buyerBand(-2, 5)).toBe('safe')
  })
})
