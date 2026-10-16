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
  const older = o({ ordered_at: '2026-10-01T00:00:00.000Z', buyer_phone: 'A' })
  const newer = o({ ordered_at: '2026-10-20T00:00:00.000Z', buyer_phone: 'B' })
  const middle = o({ ordered_at: '2026-10-10T00:00:00.000Z', buyer_phone: 'C' })

  it('defaults to newest first — the order the page opens on', () => {
    const out = sortOrders([older, newer, middle], 'newest')
    expect(out.map((x) => x.buyer_phone)).toEqual(['B', 'C', 'A'])
  })

  it('reverses for oldest first', () => {
    const out = sortOrders([older, newer, middle], 'oldest')
    expect(out.map((x) => x.buyer_phone)).toEqual(['A', 'C', 'B'])
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
    expect(sortOrders([b, a], 'newest').map((x) => x.buyer_phone)).toEqual(['A', 'B'])
  })

  it('sends an order with no date to the end, never the top', () => {
    const dated = o({ ordered_at: '2026-10-01T00:00:00.000Z', buyer_phone: 'dated' })
    const undated = o({ ordered_at: null, buyer_phone: 'undated' })
    expect(sortOrders([undated, dated], 'newest').map((x) => x.buyer_phone)).toEqual(['dated', 'undated'])
    expect(sortOrders([undated, dated], 'oldest').map((x) => x.buyer_phone)).toEqual(['dated', 'undated'])
  })

  it('never reorders the caller’s array', () => {
    const input = [older, newer]
    sortOrders(input, 'oldest')
    expect(input.map((x) => x.buyer_phone)).toEqual(['A', 'B'])
  })
})

describe('SORT_OPTIONS', () => {
  it('leads with the default and offers every rule', () => {
    expect(SORT_OPTIONS[0].value).toBe('newest')
    expect(SORT_OPTIONS.map((s) => s.value)).toEqual([
      'newest',
      'oldest',
      'amount-high',
      'amount-low',
      'risk-high',
      'status',
    ])
    // No duplicate labels in the menu.
    expect(new Set(SORT_OPTIONS.map((s) => s.label)).size).toBe(SORT_OPTIONS.length)
  })
})
