import { describe, expect, it } from 'vitest'
import { SORT_OPTIONS, orderAmount, sortOrders, statusRank, type SortableOrder } from './order-sort'

function o(over: Partial<SortableOrder> = {}): SortableOrder {
  return {
    buyer_phone: '+923001112222',
    ordered_at: '2026-10-01T10:00:00.000Z',
    price: 1000,
    quantity: 1,
    outcomes: { status: 'pending' },
    buyers: { risk_score: 0.5 },
    ...over,
  }
}

describe('orderAmount', () => {
  it('is unit price times quantity, as the Amount column shows it', () => {
    expect(orderAmount(o({ price: 1200, quantity: 3 }))).toBe(3600)
    expect(orderAmount(o({ price: null, quantity: 3 }))).toBe(0)
    expect(orderAmount(o({ price: 500, quantity: null }))).toBe(500)
  })
})

describe('sortOrders', () => {
  // 1 Oct (oldest), 10 Oct, 20 Oct (newest).
  const oct1 = o({ ordered_at: '2026-10-01T00:00:00.000Z', buyer_phone: 'A' })
  const oct10 = o({ ordered_at: '2026-10-10T00:00:00.000Z', buyer_phone: 'C' })
  const oct20 = o({ ordered_at: '2026-10-20T00:00:00.000Z', buyer_phone: 'B' })
  const all = [oct1, oct20, oct10]

  it('"New to old" puts the most recent order in the TOP row', () => {
    const out = sortOrders(all, 'new-to-old')
    expect(out[0].ordered_at).toBe('2026-10-20T00:00:00.000Z')
    expect(out.map((x) => x.buyer_phone)).toEqual(['B', 'C', 'A'])
    // And the dates strictly decrease down the table.
    const times = out.map((x) => new Date(x.ordered_at!).getTime())
    expect(times).toEqual([...times].sort((p, q) => q - p))
  })

  it('"Old to new" puts the oldest order in the TOP row', () => {
    const out = sortOrders(all, 'old-to-new')
    expect(out[0].ordered_at).toBe('2026-10-01T00:00:00.000Z')
    expect(out.map((x) => x.buyer_phone)).toEqual(['A', 'C', 'B'])
    const times = out.map((x) => new Date(x.ordered_at!).getTime())
    expect(times).toEqual([...times].sort((p, q) => p - q))
  })

  it('is not fooled by the order the rows arrive in', () => {
    // The query hands them over newest-first; shuffled input must not change
    // which row ends up on top.
    expect(sortOrders(all, 'new-to-old')[0].buyer_phone).toBe('B')
    expect(sortOrders([oct10, oct1, oct20], 'new-to-old')[0].buyer_phone).toBe('B')
    expect(sortOrders([oct20, oct1, oct10], 'old-to-new')[0].buyer_phone).toBe('A')
  })

  it('defaults to new-to-old — the order the page opens on', () => {
    expect(sortOrders([oct1, oct20, oct10], 'new-to-old')[0].ordered_at).toBe('2026-10-20T00:00:00.000Z')
  })

  it('sorts by order value, not unit price', () => {
    const small = o({ price: 5000, quantity: 1, buyer_phone: 'small' })
    const large = o({ price: 2000, quantity: 4, buyer_phone: 'large' })
    expect(sortOrders([small, large], 'amount-high').map((x) => x.buyer_phone)).toEqual(['large', 'small'])
    expect(sortOrders([small, large], 'amount-low').map((x) => x.buyer_phone)).toEqual(['small', 'large'])
  })

  it('puts the riskiest buyer first, and the unscored last', () => {
    const risky = o({ buyer_phone: 'risky', buyers: { risk_score: 0.9 } })
    const safe = o({ buyer_phone: 'safe', buyers: { risk_score: 0.1 } })
    const unknown = o({ buyer_phone: 'unknown', buyers: null })
    const out = sortOrders([safe, unknown, risky], 'risk-high')
    expect(out.map((x) => x.buyer_phone)).toEqual(['risky', 'safe', 'unknown'])
  })

  it('sorts by status with the work still to do first', () => {
    const pending = o({ buyer_phone: 'p', outcomes: { status: 'pending' } })
    const refused = o({ buyer_phone: 'r', outcomes: { status: 'refused' } })
    const accepted = o({ buyer_phone: 'a', outcomes: { status: 'accepted' } })
    const out = sortOrders([accepted, refused, pending], 'status')
    expect(out.map((x) => x.buyer_phone)).toEqual(['p', 'r', 'a'])
    // A missing outcome record is pending, not a fourth state.
    expect(statusRank(o({ outcomes: null }))).toBe(0)
  })

  it('keeps a stable order when two orders share a timestamp', () => {
    const when = '2026-10-05T00:00:00.000Z'
    const b = o({ ordered_at: when, buyer_phone: 'B' })
    const a = o({ ordered_at: when, buyer_phone: 'A' })
    expect(sortOrders([b, a], 'new-to-old').map((x) => x.buyer_phone)).toEqual(['A', 'B'])
  })

  it('sends an order with no date to the end, never the top', () => {
    const dated = o({ ordered_at: '2026-10-01T00:00:00.000Z', buyer_phone: 'dated' })
    const undated = o({ ordered_at: null, buyer_phone: 'undated' })
    expect(sortOrders([undated, dated], 'new-to-old').map((x) => x.buyer_phone)).toEqual(['dated', 'undated'])
    expect(sortOrders([undated, dated], 'old-to-new').map((x) => x.buyer_phone)).toEqual(['dated', 'undated'])
  })

  it('never reorders the caller’s array', () => {
    const input = [oct1, oct20]
    sortOrders(input, 'old-to-new')
    expect(input.map((x) => x.buyer_phone)).toEqual(['A', 'B'])
  })
})

describe('SORT_OPTIONS', () => {
  it('leads with the default and offers every rule', () => {
    expect(SORT_OPTIONS[0].value).toBe('new-to-old')
    expect(SORT_OPTIONS.map((s) => s.value)).toEqual([
      'new-to-old',
      'old-to-new',
      'amount-high',
      'amount-low',
      'risk-high',
      'status',
    ])
    // No duplicate labels in the menu.
    expect(new Set(SORT_OPTIONS.map((s) => s.label)).size).toBe(SORT_OPTIONS.length)
  })

  it('names the two date rules the way a merchant reads them', () => {
    expect(SORT_OPTIONS[0].label).toBe('New to old')
    expect(SORT_OPTIONS[1].label).toBe('Old to new')
  })
})
