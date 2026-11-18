import { describe, expect, it } from 'vitest'
import { sortOrders, type SortableOrder } from './sort-orders'

const row = (
  id: string,
  date: string,
  opts: Partial<SortableOrder> & { risk?: number | null; resolved?: number } = {},
): SortableOrder & { id: string } => ({
  id,
  ordered_at: date,
  // ?? would turn the deliberate null into 1000 and hide the case under test.
  price: opts.price === undefined ? 1000 : opts.price,
  quantity: opts.quantity ?? 1,
  buyer_phone: opts.buyer_phone ?? '+923000000001',
  outcomes: opts.outcomes ?? null,
  buyers:
    opts.risk === undefined
      ? null
      : { risk_score: opts.risk, total_orders: opts.resolved ?? 4 },
})

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('sortOrders', () => {
  const rows = [
    row('a', '2026-11-01T10:00:00Z', { risk: 0.5, price: 500 }),
    row('b', '2026-11-03T10:00:00Z', { risk: 0.1, price: 2000 }),
    row('c', '2026-11-02T10:00:00Z', { risk: 0.9, price: 1000 }),
  ]

  it('sorts by date in both directions', () => {
    expect(ids(sortOrders(rows, 'date_desc'))).toEqual(['b', 'c', 'a'])
    expect(ids(sortOrders(rows, 'date_asc'))).toEqual(['a', 'c', 'b'])
  })

  it('sorts by risk in both directions', () => {
    expect(ids(sortOrders(rows, 'risk_desc'))).toEqual(['c', 'a', 'b'])
    expect(ids(sortOrders(rows, 'risk_asc'))).toEqual(['b', 'a', 'c'])
  })

  it('sorts by amount using price times quantity', () => {
    const withQty = [
      row('x', '2026-11-01T10:00:00Z', { price: 1000, quantity: 3 }),
      row('y', '2026-11-02T10:00:00Z', { price: 500, quantity: 1 }),
      row('z', '2026-11-03T10:00:00Z', { price: 2000, quantity: 1 }),
    ]
    expect(ids(sortOrders(withQty, 'amount_desc'))).toEqual(['x', 'z', 'y'])
    expect(ids(sortOrders(withQty, 'amount_asc'))).toEqual(['y', 'z', 'x'])
  })

  it('never treats an unscored buyer as safe: unknown sorts last both ways', () => {
    const mixed = [
      row('unknown', '2026-11-05T10:00:00Z', { risk: 0.01, resolved: 0 }),
      row('low', '2026-11-04T10:00:00Z', { risk: 0.1 }),
      row('high', '2026-11-03T10:00:00Z', { risk: 0.9 }),
    ]
    expect(ids(sortOrders(mixed, 'risk_desc'))).toEqual(['high', 'low', 'unknown'])
    expect(ids(sortOrders(mixed, 'risk_asc'))).toEqual(['low', 'high', 'unknown'])
  })

  it('puts pending orders first for "needs a decision"', () => {
    const mixed = [
      row('done', '2026-11-05T10:00:00Z', { outcomes: { status: 'accepted' } }),
      row('open', '2026-11-01T10:00:00Z'),
      row('refused', '2026-11-06T10:00:00Z', { outcomes: { status: 'refused' } }),
    ]
    expect(ids(sortOrders(mixed, 'status_pending'))).toEqual(['open', 'refused', 'done'])
  })

  it('sorts buyers numerically, not lexically', () => {
    const buyers = [
      row('nine', '2026-11-01T10:00:00Z', { buyer_phone: '+923000000009' }),
      row('ten', '2026-11-01T10:00:00Z', { buyer_phone: '+923000000010' }),
      row('two', '2026-11-01T10:00:00Z', { buyer_phone: '+923000000002' }),
    ]
    expect(ids(sortOrders(buyers, 'buyer_asc'))).toEqual(['two', 'nine', 'ten'])
  })

  it('keeps a missing amount last instead of first', () => {
    const withMissing = [
      row('none', '2026-11-01T10:00:00Z', { price: null as unknown as number }),
      row('cheap', '2026-11-02T10:00:00Z', { price: 100 }),
      row('dear', '2026-11-03T10:00:00Z', { price: 900 }),
    ]
    expect(ids(sortOrders(withMissing, 'amount_asc'))).toEqual(['cheap', 'dear', 'none'])
    expect(ids(sortOrders(withMissing, 'amount_desc'))).toEqual(['dear', 'cheap', 'none'])
  })

  it('does not mutate the input array', () => {
    const copy = [...rows]
    sortOrders(rows, 'date_asc')
    expect(ids(rows)).toEqual(ids(copy))
  })
})
