import { describe, expect, it } from 'vitest'
import {
  rateOf,
  valueOf,
  cityRefusalRates,
  productRefusalRates,
  weekdayRefusalRates,
  refusalTrend,
  refusalTrendSentence,
  moneyAtRisk,
  buyerSegments,
  buyerSummary,
  formatRate,
  sampleLabel,
  hasEnoughForInsight,
  actionForRate,
  MIN_SAMPLE,
  type ScoredOrder,
  type NamedRate,
} from './analytics'

function order(over: Partial<ScoredOrder> = {}): ScoredOrder {
  return { id: Math.random().toString(36).slice(2), outcome: 'accepted', ...over }
}

/** n orders for a city with the given split. */
function city(name: string, accepted: number, refused: number, pending = 0): ScoredOrder[] {
  return [
    ...Array.from({ length: accepted }, () => order({ city: name, outcome: 'accepted' })),
    ...Array.from({ length: refused }, () => order({ city: name, outcome: 'refused' })),
    ...Array.from({ length: pending }, () => order({ city: name, outcome: 'pending' })),
  ]
}

describe('rateOf', () => {
  it('keeps unknown outcomes in their own bucket', () => {
    const r = rateOf([
      order({ outcome: 'accepted' }),
      order({ outcome: 'refused' }),
      order({ outcome: 'pending' }),
      order({ outcome: null }),
    ])
    expect(r).toMatchObject({ accepted: 1, refused: 1, unknown: 2, resolved: 2 })
    expect(r.rate).toBe(0.5)
  })

  it('never invents a rate with nothing resolved', () => {
    const r = rateOf([order({ outcome: 'pending' })])
    expect(r.rate).toBeNull()
    expect(r.confident).toBe(false)
  })

  it('is only confident at the minimum sample', () => {
    expect(rateOf(city('X', 8, 1)).confident).toBe(false)
    expect(rateOf(city('X', MIN_SAMPLE - 1, 1)).confident).toBe(true)
  })
})

describe('valueOf', () => {
  it('multiplies price by quantity', () => {
    expect(valueOf([order({ price: 100, quantity: 3 })])).toBe(300)
  })

  it('returns null when no order carries a price, never a fake zero', () => {
    expect(valueOf([order({ price: null })])).toBeNull()
    expect(valueOf([])).toBeNull()
  })
})

describe('cityRefusalRates', () => {
  it('hides cities without enough resolved orders', () => {
    const orders = [...city('Lahore', 1, 1), ...city('Karachi', 30, 10)]
    const rows = cityRefusalRates(orders)
    expect(rows.map((r) => r.name)).toEqual(['Karachi'])
  })

  it('merges the same city written differently', () => {
    const orders = [...city('lahore', 20, 5), ...city('LAHORE ', 10, 5), ...city(' Lahore', 5, 5)]
    const rows = cityRefusalRates(orders)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Lahore')
    expect(rows[0].orders).toBe(50)
  })

  it('puts the worst refusal rate first', () => {
    const orders = [...city('Karachi', 20, 20), ...city('Lahore', 30, 3), ...city('Multan', 10, 9)]
    // Karachi 20/40 = 50%, Multan 9/19 = 47%, Lahore 3/33 = 9%
    expect(cityRefusalRates(orders).map((r) => r.name)).toEqual(['Karachi', 'Multan', 'Lahore'])
  })

  it('breaks a tie in refusal rate with the bigger sample', () => {
    const orders = [...city('Small', 5, 5), ...city('Big', 30, 30)]
    expect(cityRefusalRates(orders).map((r) => r.name)).toEqual(['Big', 'Small'])
  })

  it('publishes a ranked list from a small sample, flagged rather than hidden', () => {
    // The bug this guards: MIN_SAMPLE (10) applied per group emptied both
    // "Cities that refuse most" and "Products that refuse most" on a book with
    // 82 resolved orders spread thin — totals showed refusals and the ranking
    // beside them was empty.
    const orders = [...city('Sialkot', 4, 3), ...city('Karachi', 30, 10)]
    const rows = cityRefusalRates(orders)
    const sialkot = rows.find((r) => r.name === 'Sialkot')
    expect(sialkot).toBeDefined()
    // ...and the row still admits it is thin rather than posing as a figure.
    expect(sialkot!.confident).toBe(false)
    expect(rows.find((r) => r.name === 'Karachi')!.confident).toBe(true)
  })

  it('still refuses a group with fewer than three resolved orders', () => {
    // Two resolved orders is an anecdote, not a rate. `city(name, accepted, refused)`.
    const orders = [...city('Quetta', 1, 1), ...city('Karachi', 30, 10)]
    expect(cityRefusalRates(orders).map((r) => r.name)).toEqual(['Karachi'])
  })

  it('skips orders with no city', () => {
    expect(cityRefusalRates([...city('Lahore', 20, 0), order({ city: null })])).toHaveLength(1)
  })
})

describe('productRefusalRates', () => {
  it('falls back to the category when there is no product name', () => {
    const orders = [
      ...Array.from({ length: 10 }, () => order({ product_name: null, product_category: 'footwear', outcome: 'refused' })),
      ...Array.from({ length: 10 }, () => order({ product_name: 'Serum', outcome: 'accepted' })),
    ]
    const rows = productRefusalRates(orders)
    expect(rows.map((r) => r.name)).toEqual(['footwear', 'Serum'])
    expect(rows[0].rate).toBe(1)
  })
})

describe('weekdayRefusalRates', () => {
  it('groups by weekday name and needs real dates', () => {
    // 2024-01-01 was a Monday
    const orders = [
      ...Array.from({ length: 10 }, () => order({ ordered_at: '2024-01-01T10:00:00Z', outcome: 'refused' })),
      ...Array.from({ length: 10 }, () => order({ ordered_at: '2024-01-02T10:00:00Z', outcome: 'accepted' })),
    ]
    const rows = weekdayRefusalRates(orders)
    const names = rows.map((r) => r.name)
    expect(names).toContain('Monday')
    expect(rows.find((r) => r.name === 'Monday')?.rate).toBe(1)
    expect(weekdayRefusalRates([order({ ordered_at: null })])).toHaveLength(0)
  })
})

describe('refusalTrend', () => {
  const now = Date.parse('2024-03-10T12:00:00Z')
  const day = 86_400_000

  /**
   * The trend buckets by whole local days, so the test builds dates from a
   * local-day boundary rather than a fixed UTC instant — otherwise the
   * expectation would depend on the machine's timezone.
   */
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const onDay = (back: number, hour = 10) =>
    new Date(startOfToday - back * day + hour * 3_600_000).toISOString()

  it('compares the last week with the week before', () => {
    const orders = [
      // today through 6 days ago: 2 refusals in 10
      ...Array.from({ length: 10 }, (_, i) => order({ ordered_at: onDay(i % 7), outcome: i < 2 ? 'refused' : 'accepted' })),
      // 7 through 13 days ago: 5 refusals in 10
      ...Array.from({ length: 10 }, (_, i) => order({ ordered_at: onDay(7 + (i % 7)), outcome: i < 5 ? 'refused' : 'accepted' })),
    ]
    const t = refusalTrend(orders, 7, now)
    expect(t).not.toBeNull()
    expect(t!.current.resolved).toBe(10)
    expect(t!.previous.resolved).toBe(10)
    expect(t!.deltaPoints).toBeCloseTo(-30, 0)
    expect(refusalTrendSentence(t)).toContain('down to 20%')
  })

  it('returns null when no order has a usable date', () => {
    expect(refusalTrend([order({ ordered_at: null })], 7, now)).toBeNull()
  })

  it('says so instead of comparing tiny samples', () => {
    const orders = [
      order({ ordered_at: onDay(0), outcome: 'refused' }),
      order({ ordered_at: onDay(8), outcome: 'accepted' }),
    ]
    const t = refusalTrend(orders, 7, now)
    expect(t!.confident).toBe(false)
    expect(refusalTrendSentence(t)).toContain('Not enough resolved orders')
  })

  it('returns null sentence when the rate is unknown', () => {
    expect(refusalTrendSentence(null)).toBeNull()
  })
})

describe('moneyAtRisk', () => {
  const toneOf = (o: ScoredOrder): 'safe' | 'watch' | 'high' | 'unknown' =>
    o.city === 'Risky' ? 'high' : 'safe'

  it('adds up only risky pending orders', () => {
    const orders = [
      order({ city: 'Risky', price: 1000, quantity: 2, outcome: 'pending' }),
      order({ city: 'Safe', price: 500, outcome: 'pending' }),
      order({ city: 'Risky', price: 9999, outcome: 'refused' }),
    ]
    const m = moneyAtRisk(orders, toneOf as never)
    expect(m.atRisk).toBe(2000)
    expect(m.refused).toBe(9999)
    expect(m.undecided).toBe(2500)
    expect(m.basedOn).toBe(3)
  })

  it('returns null instead of zero when there is nothing to show', () => {
    const m = moneyAtRisk([order({ outcome: 'accepted', price: 100 })], toneOf as never)
    expect(m.atRisk).toBeNull()
    expect(m.refused).toBeNull()
    expect(m.undecided).toBeNull()
  })
})

describe('buyerSegments', () => {
  const buyers = [
    { phone: 'a', total_orders: 10, total_accepted: 10, total_refused: 0, risk_score: 0.1, spend: 50000 },
    { phone: 'b', total_orders: 6, total_accepted: 5, total_refused: 1, risk_score: 0.2, spend: 10000 },
    { phone: 'c', total_orders: 4, total_accepted: 1, total_refused: 3, risk_score: 0.8, spend: 5000 },
    { phone: 'd', total_orders: 2, total_accepted: 1, total_refused: 0, risk_score: 0.5, spend: 0 },
  ]

  it('groups by rules over real fields', () => {
    const segs = buyerSegments(buyers)
    const keys = segs.map((s) => s.key)
    expect(keys).toContain('repeat')
    expect(keys).toContain('confirm')
    expect(keys).toContain('thin')
  })

  it('puts a never-refused buyer with spend in the valuable group', () => {
    const valuable = buyerSegments(buyers).find((s) => s.key === 'valuable')
    expect(valuable?.buyers.map((b) => b.phone)).toContain('a')
  })

  it('treats thin history as its own group, not as risk', () => {
    const thin = buyerSegments(buyers).find((s) => s.key === 'thin')
    expect(thin?.buyers.map((b) => b.phone)).toEqual(['d'])
    expect(thin?.detail).toContain('Not a risk signal')
  })

  it('drops groups that would be empty', () => {
    expect(buyerSegments([])).toEqual([])
  })
})

describe('display helpers', () => {
  const group = (rate: number | null, resolved: number, orders: number): NamedRate => ({
    name: 'Lahore',
    orders,
    value: 1000,
    resolved,
    accepted: resolved - Math.round((rate ?? 0) * resolved),
    refused: Math.round((rate ?? 0) * resolved),
    unknown: orders - resolved,
    rate,
    confident: resolved >= MIN_SAMPLE,
  })

  it('formats a rate as whole percent', () => {
    expect(formatRate(0.34)).toBe('34%')
    expect(formatRate(0)).toBe('0%')
    expect(formatRate(1)).toBe('100%')
  })

  it('shows a dash rather than a fake rate', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(undefined)).toBe('—')
    expect(formatRate(Number.NaN)).toBe('—')
  })

  it('states the sample behind a rate', () => {
    expect(sampleLabel(group(0.5, 10, 14))).toBe('10 resolved of 14 orders')
    expect(sampleLabel(group(0.5, 1, 1))).toBe('1 resolved of 1 order')
  })

  it('hides an insight when there is nothing to show', () => {
    expect(hasEnoughForInsight([])).toBe(false)
    expect(hasEnoughForInsight([group(0.5, 10, 10)])).toBe(true)
  })

  it('suggests a confirmation call only for a high refusal rate', () => {
    expect(actionForRate(group(0.6, 20, 20), 'city')).toContain('confirmation call')
    expect(actionForRate(group(0.35, 20, 20), 'product')).toContain('Worth watching')
    expect(actionForRate(group(0.05, 20, 20), 'weekday')).toContain('No change needed')
  })

  it('never claims Verafo prevented anything', () => {
    for (const r of [0.6, 0.35, 0.05]) {
      const s = actionForRate(group(r, 20, 20), 'city')
      expect(s).not.toMatch(/prevented|saved|Verafo/)
    }
  })
})

describe('buyerSummary', () => {  it('includes only the parts it was given', () => {
    const s = buyerSummary({ phone: '0300 1234567', verdictWord: 'LOW RISK', riskScore: 0.12, totalOrders: 12, accepted: 12, refused: 0, stores: 3 })
    expect(s).toContain('LOW RISK')
    expect(s).toContain('0.12')
    expect(s).toContain('12 orders in the network')
    expect(s).toContain('3 connected stores')
    expect(s.endsWith('Checked with Verafo.')).toBe(true)
  })

  it('never invents a score it was not given', () => {
    const s = buyerSummary({ phone: '0300 1234567', verdictWord: 'UNKNOWN' })
    expect(s).not.toContain('Risk score')
  })
})
