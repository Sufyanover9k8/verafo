import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  normalizeDimension,
  normalizeMetric,
  refusalPercent,
  presentAggregate,
  presentBuyerRank,
  auditAggregateOutput,
  refusalHeadline,
  AGGREGATE_DIMENSIONS,
  RANK_METRICS,
  type AggregateRow,
} from './aggregates'

const row = (over: Partial<AggregateRow> = {}): AggregateRow => ({
  bucket: 'Lahore',
  orders: 40,
  buyers: 25,
  value: 120000,
  accepted: 30,
  refused: 10,
  pending: 0,
  refusal_rate: 0.25,
  ...over,
})

describe('normalizeDimension', () => {
  it('accepts every supported dimension', () => {
    for (const d of AGGREGATE_DIMENSIONS) expect(normalizeDimension(d)).toBe(d)
  })

  it('is case and whitespace insensitive', () => {
    expect(normalizeDimension('  CITY ')).toBe('city')
  })

  it('falls back to a supported dimension for anything unknown, never to raw rows', () => {
    for (const bad of ['orders', '', null, undefined, 42, {}]) {
      expect(AGGREGATE_DIMENSIONS).toContain(normalizeDimension(bad))
    }
  })
})

describe('normalizeMetric', () => {
  it('accepts every supported metric', () => {
    for (const m of RANK_METRICS) expect(normalizeMetric(m)).toBe(m)
  })

  it('falls back to orders, so an unsupported metric cannot change the query shape', () => {
    expect(normalizeMetric('profit')).toBe('orders')
    expect(normalizeMetric(null)).toBe('orders')
  })
})

describe('refusalPercent', () => {
  it('renders whole percent', () => {
    expect(refusalPercent(0.25)).toBe(25)
    expect(refusalPercent(1)).toBe(100)
    expect(refusalPercent(0)).toBe(0)
  })

  it('stays null when nothing resolved, rather than claiming 0%', () => {
    expect(refusalPercent(null)).toBeNull()
    expect(refusalPercent(undefined)).toBeNull()
    expect(refusalPercent(Number.NaN)).toBeNull()
  })
})

describe('presentAggregate', () => {
  it('carries the statistics through', () => {
    const p = presentAggregate(row())
    expect(p.bucket).toBe('Lahore')
    expect(p.orders).toBe(40)
    expect(p.buyers).toBe(25)
    expect(p.refusal_percent).toBe(25)
    expect(p.value).toBe(120000)
  })

  it('coerces junk numbers to 0 rather than NaN leaking to the model', () => {
    const p = presentAggregate(row({ orders: 'x' as unknown as number, value: null as unknown as number }))
    expect(p.orders).toBe(0)
    expect(p.value).toBe(0)
  })

  it('never emits an identity field', () => {
    const p = presentAggregate(row())
    for (const key of Object.keys(p)) {
      expect(['bucket', 'orders', 'buyers', 'accepted', 'refused', 'pending', 'refusal_percent', 'value']).toContain(key)
    }
  })
})

describe('presentBuyerRank', () => {
  it('keeps the masked label the database produced', () => {
    const p = presentBuyerRank({
      rank: 1,
      buyer_label: '····2288',
      orders: 12,
      accepted: 12,
      refused: 0,
      value: 40000,
      risk_score: 0.12,
      store_count: 3,
    })
    expect(p.buyer).toBe('····2288')
    expect(p.score ?? p.risk_score).toBe(0.12)
  })

  it('passes a null score through as null, never as zero', () => {
    const p = presentBuyerRank({
      rank: 2,
      buyer_label: '····1111',
      orders: 1,
      accepted: 0,
      refused: 0,
      value: 0,
      risk_score: null,
      store_count: 1,
    })
    expect(p.risk_score).toBeNull()
  })
})

describe('SAFETY: auditAggregateOutput', () => {
  it('passes clean aggregate rows', () => {
    const r = auditAggregateOutput([presentAggregate(row()), presentAggregate(row({ bucket: 'Karachi' }))])
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('passes a masked buyer ranking', () => {
    const r = auditAggregateOutput([
      presentBuyerRank({ rank: 1, buyer_label: '····2288', orders: 5, accepted: 5, refused: 0, value: 100, risk_score: 0.1, store_count: 2 }),
    ])
    expect(r.ok).toBe(true)
  })

  it('catches an unmasked full phone number in a ranking label', () => {
    const r = auditAggregateOutput([{ rank: 1, buyer: '+923001234567' }])
    expect(r.ok).toBe(false)
    expect(r.violations.join(' ')).toContain('full phone number')
  })

  it('catches a local-format full number too', () => {
    const r = auditAggregateOutput([{ buyer: '0300 1234567' }])
    expect(r.ok).toBe(false)
  })

  it('catches a leaked embedding or address', () => {
    expect(auditAggregateOutput([{ bucket: 'Lahore', embedding: [0.1] }]).ok).toBe(false)
    expect(auditAggregateOutput([{ bucket: 'Lahore', address: '12 Main St' }]).ok).toBe(false)
    expect(auditAggregateOutput([{ bucket: 'Lahore', feature_vector: [1] }]).ok).toBe(false)
    expect(auditAggregateOutput([{ bucket: 'Lahore', refusal_reason: 'note' }]).ok).toBe(false)
  })

  it('handles empty and non-object input', () => {
    expect(auditAggregateOutput([]).ok).toBe(true)
    expect(auditAggregateOutput([null, 1, 'x']).ok).toBe(true)
  })
})

describe('refusalHeadline', () => {
  it('states a rate with its sample', () => {
    expect(refusalHeadline(10, 40)).toBe('25% refused, from 40 resolved orders.')
  })

  it('refuses to state a rate on a thin sample', () => {
    expect(refusalHeadline(1, 3)).toContain('Not enough resolved orders')
    expect(refusalHeadline(1, 0)).toContain('Not enough resolved orders')
  })
})

describe('SAFETY: the aggregate tools no longer read orders raw', () => {
  const src = readFileSync(resolve(process.cwd(), 'supabase/functions/verafo-ai/index.ts'), 'utf8')

  /** Pull one function's body out of the edge function source. */
  function bodyOf(name: string): string {
    const start = src.indexOf(`async function ${name}(`)
    expect(start, `${name} not found`).toBeGreaterThan(-1)
    // Walk braces to the matching close.
    let depth = 0
    let i = src.indexOf('{', start)
    const from = i
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    return src.slice(from, i + 1)
  }

  for (const tool of [
    'toolCityOverview',
    'toolCategoryOverview',
    'toolTopProducts',
    'toolRefusalReasons',
  ]) {
    it(`${tool} uses the aggregate RPC and never reads orders`, () => {
      const body = bodyOf(tool)
      expect(body).toContain('verafo_aggregate_stats')
      expect(body).not.toContain('fetchRows')
      expect(body).not.toMatch(/from\(["']orders["']\)/)
    })
  }

  it('the aggregate RPC is called with a validated dimension', () => {
    for (const tool of ['toolCityOverview', 'toolCategoryOverview', 'toolTopProducts', 'toolRefusalReasons']) {
      expect(bodyOf(tool)).toMatch(/p_dimension:\s*"/)
    }
  })

  it('the ranking function is never called with a phone-returning shape', () => {
    expect(src).toContain('verafo_buyer_ranking')
    // The ranking must come from the masked RPC, not from a buyers select.
    expect(src).not.toMatch(/verafo_buyer_ranking[\s\S]{0,200}select\("phone"\)/)
  })

  it('every ranking call passes the caller own store ids', () => {
    // verafo_buyer_ranking(p_store_ids, ...) ranks ONLY the stores it is
    // given, and an empty list returns nothing (supabase/aggregate-stats-migration.sql).
    // A call site that forgot p_store_ids would silently rank nobody - or,
    // with the old signature, the whole network - so pin every one of them.
    const calls = src.split('verafo_buyer_ranking"').slice(1)
    expect(calls.length).toBeGreaterThan(0)
    for (const tail of calls) {
      expect(tail.slice(0, 200)).toContain('p_store_ids: storeIds')
    }
  })
})
