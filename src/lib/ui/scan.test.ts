import { describe, expect, it } from 'vitest'
import {
  planBatches,
  progressOf,
  summariseScan,
  scanHeadline,
  scanCaveats,
  scanKey,
  dedupeScanned,
  type ScanInput,
} from './scan'
import { MIN_SAMPLE } from './analytics'

const o = (over: Partial<ScanInput> = {}): ScanInput => ({
  id: Math.random().toString(36).slice(2),
  outcome: 'accepted',
  buyerOrders: 5,
  riskScore: 0.1,
  price: 1000,
  ...over,
})

describe('planBatches', () => {
  it('splits a total into fixed-size batches', () => {
    const b = planBatches(120, 50)
    expect(b).toHaveLength(3)
    expect(b.map((x) => [x.from, x.to])).toEqual([
      [0, 50],
      [50, 100],
      [100, 120],
    ])
    expect(b.map((x) => x.index)).toEqual([0, 1, 2])
  })

  it('handles an exact multiple without an empty tail batch', () => {
    expect(planBatches(100, 50)).toHaveLength(2)
  })

  it('returns nothing for an empty or invalid total', () => {
    expect(planBatches(0)).toEqual([])
    expect(planBatches(-5)).toEqual([])
    expect(planBatches(Number.NaN)).toEqual([])
  })

  it('never produces a zero-size batch', () => {
    const b = planBatches(3, 0)
    expect(b.length).toBe(3)
    expect(b[0]).toEqual({ index: 0, from: 0, to: 1 })
  })
})

describe('progressOf', () => {
  it('reports a fraction', () => {
    expect(progressOf(0, 100)).toBe(0)
    expect(progressOf(50, 100)).toBe(0.5)
    expect(progressOf(100, 100)).toBe(1)
  })

  it('clamps and survives a zero total', () => {
    expect(progressOf(5, 0)).toBe(0)
    expect(progressOf(150, 100)).toBe(1)
    expect(progressOf(-5, 100)).toBe(0)
  })
})

describe('summariseScan', () => {
  it('counts outcomes, keeping unknown separate', () => {
    const s = summariseScan([
      o({ outcome: 'accepted' }),
      o({ outcome: 'refused' }),
      o({ outcome: 'pending' }),
      o({ outcome: null }),
    ])
    expect(s.scanned).toBe(4)
    expect(s.accepted).toBe(1)
    expect(s.refused).toBe(1)
    expect(s.unknownOutcome).toBe(2)
    expect(s.skippedMissingOutcome).toBe(1)
  })

  it('never counts an unscored buyer as safe or as high risk', () => {
    const s = summariseScan([
      o({ buyerOrders: 0, riskScore: 0.9 }),
      o({ buyerOrders: 5, riskScore: 0.9 }),
    ])
    expect(s.unscored).toBe(1)
    expect(s.highRisk).toBe(1)
    expect(s.scored).toBe(1)
  })

  it('buckets scored buyers with the app thresholds', () => {
    const s = summariseScan([
      o({ riskScore: 0.1 }),
      o({ riskScore: 0.5 }),
      o({ riskScore: 0.9 }),
    ])
    expect([s.lowRisk, s.mediumRisk, s.highRisk]).toEqual([1, 1, 1])
  })

  it('withholds a refusal rate below the minimum sample', () => {
    const s = summariseScan([o({ outcome: 'refused' }), o({ outcome: 'accepted' })])
    expect(s.rateWithheld).toBe(true)
    expect(scanCaveats(s).join(' ')).toContain(`Fewer than ${MIN_SAMPLE}`)
  })

  it('publishes a refusal rate at the minimum sample', () => {
    const rows = [
      ...Array.from({ length: MIN_SAMPLE }, () => o({ outcome: 'accepted' })),
      ...Array.from({ length: MIN_SAMPLE }, () => o({ outcome: 'refused' })),
    ]
    const s = summariseScan(rows)
    expect(s.rateWithheld).toBe(false)
    expect(s.refusalRate).toBeCloseTo(0.5, 5)
  })

  it('sums refused value and value still exposed, and keeps them apart', () => {
    const s = summariseScan([
      o({ outcome: 'refused', price: 500 }),
      o({ outcome: 'pending', price: 300 }),
      o({ outcome: 'accepted', price: 900 }),
    ])
    expect(s.refusedValue).toBe(500)
    expect(s.valueAtRisk).toBe(300)
  })

  it('leaves value unknown rather than zero when no price exists', () => {
    const s = summariseScan([o({ outcome: 'refused', price: null })])
    expect(s.refusedValue).toBeNull()
    expect(s.valueAtRisk).toBeNull()
  })

  it('does not count an unscored buyer order as value at risk', () => {
    const s = summariseScan([o({ outcome: 'pending', buyerOrders: 0, price: 700 })])
    expect(s.valueAtRisk).toBeNull()
  })

  it('handles an empty set', () => {
    const s = summariseScan([])
    expect(s.scanned).toBe(0)
    expect(s.refusalRate).toBeNull()
    expect(scanHeadline(s)).toBe('No historical orders to scan.')
  })
})

describe('scanHeadline', () => {
  it('is retrospective and never claims prevention or savings', () => {
    const s = summariseScan([o({ outcome: 'refused' })])
    const h = scanHeadline(s)
    expect(h).toContain('worked out now')
    expect(h).toContain('did not see these orders when they were placed')
    expect(h).not.toMatch(/prevented|saved|saving/i)
  })
})

describe('scanCaveats', () => {
  it('always states that scores are retrospective', () => {
    const c = scanCaveats(summariseScan([o()]))
    expect(c[0]).toContain('not the scores that existed when these orders were placed')
    expect(c[0]).toContain('did not prevent any of them')
  })

  it('explains unscored buyers as missing information, not risk', () => {
    const c = scanCaveats(summariseScan([o({ buyerOrders: 0 })]))
    expect(c.join(' ')).toContain('missing information, not a risk signal')
  })

  it('separates order value from profit', () => {
    const c = scanCaveats(summariseScan([o({ outcome: 'refused', price: 100 })]))
    expect(c.join(' ')).toContain('Order value is not profit')
  })
})

describe('scanKey / dedupeScanned', () => {
  it('prefers the row id', () => {
    expect(scanKey({ id: 'abc' })).toBe('abc')
  })

  it('falls back to buyer and date when there is no id', () => {
    expect(scanKey({ buyer_phone: '0300', ordered_at: '2024-01-01' })).toBe('0300|2024-01-01')
  })

  it('drops rows already counted by a previous scan', () => {
    const seen = new Set(['a'])
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(dedupeScanned(rows, seen).map((r) => r.id)).toEqual(['b', 'c'])
  })

  it('drops duplicates inside the same run', () => {
    const rows = [{ id: 'a' }, { id: 'a' }, { id: 'b' }]
    expect(dedupeScanned(rows, new Set()).map((r) => r.id)).toEqual(['a', 'b'])
  })
})
