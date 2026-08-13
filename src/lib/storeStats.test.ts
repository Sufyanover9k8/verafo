import { describe, expect, it } from 'vitest'
import { computeDailySales, computeStoreOverview } from './storeStats'
import type { OrderRow } from './types'

const stores = [
  { id: 's1', name: 'Sanicore', created_at: '2026-01-01T00:00:00Z', shopify_domain: 'sanicore.myshopify.com' },
  { id: 's2', name: 'Urban Threads' },
]

function order(partial: Partial<OrderRow> & { id: string; store_id: string }): OrderRow {
  return {
    buyer_phone: '+923000000000',
    product_category: null,
    product_name: null,
    price: null,
    quantity: 1,
    address: null,
    city: null,
    ordered_at: null,
    outcomes: null,
    ...partial,
  }
}

describe('computeStoreOverview', () => {
  it('aggregates orders per store and keeps zero-order stores', () => {
    const now = Date.now()
    const orders: OrderRow[] = [
      order({ id: 'o1', store_id: 's1', buyer_phone: '+92 300 1', price: 1000, quantity: 2, ordered_at: new Date(now - 1000).toISOString(), outcomes: { status: 'accepted', resolved_at: null, refusal_reason: null } }),
      order({ id: 'o2', store_id: 's1', buyer_phone: '+92 300 1', price: 500, quantity: 1, ordered_at: new Date(now - 2000).toISOString(), outcomes: { status: 'refused', resolved_at: null, refusal_reason: null } }),
      order({ id: 'o3', store_id: 's1', buyer_phone: '+92 300 2', price: 200, quantity: 1, ordered_at: new Date(now - 3000).toISOString(), outcomes: null }),
    ]
    const result = computeStoreOverview(orders, stores)
    expect(result).toHaveLength(2)
    const s1 = result[0]
    expect(s1.orders).toBe(3)
    expect(s1.accepted).toBe(1)
    expect(s1.refused).toBe(1)
    expect(s1.pending).toBe(1)
    expect(s1.revenue).toBe(2700)
    expect(s1.buyers).toBe(2)
    expect(s1.avg_order_value).toBe(900)
    expect(result[1].orders).toBe(0)
    expect(result[1].revenue).toBe(0)
  })
})

describe('computeDailySales', () => {
  it('buckets orders by local day and fills empty days with zeros', () => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const orders: OrderRow[] = [
      order({ id: 'o1', store_id: 's1', price: 1000, quantity: 1, ordered_at: today.toISOString() }),
      order({ id: 'o2', store_id: 's1', price: 500, quantity: 2, ordered_at: yesterday.toISOString() }),
    ]
    const rows = computeDailySales(orders, 7)
    expect(rows).toHaveLength(7)
    expect(rows[6].orders).toBe(1)
    expect(rows[6].revenue).toBe(1000)
    expect(rows[5].orders).toBe(1)
    expect(rows[5].revenue).toBe(1000)
    expect(rows[0].revenue).toBe(0)
  })
})