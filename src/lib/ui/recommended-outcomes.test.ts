import { describe, expect, it } from 'vitest'
import {
  isPending,
  isRecommendedAcceptance,
  recommendedAcceptances,
} from './recommended-outcomes'

const buyer = (risk_score: number, total_orders = 5) => ({ risk_score, total_orders })

describe('isPending', () => {
  it('treats a missing outcome as pending', () => {
    expect(isPending({})).toBe(true)
    expect(isPending({ outcomes: null })).toBe(true)
    expect(isPending({ outcomes: { status: 'pending' } })).toBe(true)
  })

  it('does not treat a resolved outcome as pending', () => {
    expect(isPending({ outcomes: { status: 'accepted' } })).toBe(false)
    expect(isPending({ outcomes: { status: 'refused' } })).toBe(false)
  })
})

describe('isRecommendedAcceptance', () => {
  it('accepts a scored low-risk buyer', () => {
    expect(isRecommendedAcceptance({ buyers: buyer(0.12) })).toBe(true)
    expect(isRecommendedAcceptance({ buyers: buyer(0.44) })).toBe(true)
  })

  it('never accepts medium or high risk', () => {
    expect(isRecommendedAcceptance({ buyers: buyer(0.45) })).toBe(false)
    expect(isRecommendedAcceptance({ buyers: buyer(0.65) })).toBe(false)
    expect(isRecommendedAcceptance({ buyers: buyer(0.9) })).toBe(false)
  })

  it('never accepts an unscored buyer, even with a safe-looking score', () => {
    // total_orders = 0 means UNKNOWN: no resolved history, so nothing to trust.
    expect(isRecommendedAcceptance({ buyers: buyer(0.1, 0) })).toBe(false)
    expect(isRecommendedAcceptance({ buyers: { risk_score: 0.1, total_orders: null } })).toBe(false)
    expect(isRecommendedAcceptance({ buyers: null })).toBe(false)
    expect(isRecommendedAcceptance({})).toBe(false)
  })

  it('leaves already-resolved orders alone', () => {
    expect(
      isRecommendedAcceptance({ buyers: buyer(0.1), outcomes: { status: 'accepted' } }),
    ).toBe(false)
    expect(
      isRecommendedAcceptance({ buyers: buyer(0.1), outcomes: { status: 'refused' } }),
    ).toBe(false)
  })

  it('handles a missing or non-numeric score defensively', () => {
    expect(isRecommendedAcceptance({ buyers: { risk_score: null, total_orders: 4 } })).toBe(false)
    expect(
      isRecommendedAcceptance({ buyers: { risk_score: Number.NaN, total_orders: 4 } }),
    ).toBe(false)
  })
})

describe('recommendedAcceptances', () => {
  it('returns only the pending low-risk rows', () => {
    const rows = [
      { id: 'a', buyers: buyer(0.1) },
      { id: 'b', buyers: buyer(0.8) },
      { id: 'c', buyers: buyer(0.2, 0) },
      { id: 'd', buyers: buyer(0.3), outcomes: { status: 'refused' } },
      { id: 'e', buyers: buyer(0.5) },
    ]
    expect(recommendedAcceptances(rows).map((r) => r.id)).toEqual(['a'])
  })

  it('returns an empty list when nothing qualifies', () => {
    expect(recommendedAcceptances([])).toEqual([])
    expect(recommendedAcceptances([{ id: 'x', buyers: buyer(0.9) }])).toEqual([])
  })
})
