import { describe, expect, it } from 'vitest'
import { computeCityStats, computeDailySales, computeStoreOverview, computeTopProducts, isIdleSince } from './storeStats'
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

describe('isIdleSince', () => {
  it('treats missing or stale last-order dates as idle, recent as active', () => {
    expect(isIdleSince(null)).toBe(true)
    const stale = new Date(Date.now() - 20 * 86400000).toISOString()
    const fresh = new Date(Date.now() - 2 * 86400000).toISOString()
    expect(isIdleSince(stale)).toBe(true)
    expect(isIdleSince(fresh)).toBe(false)
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

describe('computeCityStats', () => {
  it('aggregates orders by city, sorted by revenue, with share of total', () => {
    const orders: OrderRow[] = [
      order({ id: 'o1', store_id: 's1', city: 'karachi', price: 1000, quantity: 2 }),
      order({ id: 'o2', store_id: 's1', city: '  Lahore ', price: 500, quantity: 1 }),
      order({ id: 'o3', store_id: 's1', city: 'karachi', price: 300, quantity: 1 }),
      order({ id: 'o4', store_id: 's1', price: 100, quantity: 1 }),
    ]
    const rows = computeCityStats(orders)
    expect(rows[0]).toEqual({ city: 'Karachi', orders: 2, revenue: 2300, share: 79 })
    expect(rows[1]).toEqual({ city: 'Lahore', orders: 1, revenue: 500, share: 17 })
    expect(rows[2]).toEqual({ city: 'Unknown', orders: 1, revenue: 100, share: 3 })
    expect(rows).toHaveLength(3)
  })

  it('honours the limit', () => {
    const orders: OrderRow[] = [
      order({ id: 'o1', store_id: 's1', city: 'Karachi', price: 100 }),
      order({ id: 'o2', store_id: 's1', city: 'Lahore', price: 100 }),
      order({ id: 'o3', store_id: 's1', city: 'Multan', price: 100 }),
      order({ id: 'o4', store_id: 's1', city: 'Peshawar', price: 100 }),
    ]
    expect(computeCityStats(orders, 2)).toHaveLength(2)
  })
})

describe('computeTopProducts', () => {
  it('ranks products by revenue, keeping category and share', () => {
    const orders: OrderRow[] = [
      order({ id: 'o1', store_id: 's1', product_name: 'Sneakers', product_category: 'Footwear', price: 2000, quantity: 1 }),
      order({ id: 'o2', store_id: 's1', product_name: 'Sneakers', product_category: 'Footwear', price: 2000, quantity: 1 }),
      order({ id: 'o3', store_id: 's1', product_name: 'Cap', product_category: 'Accessories', price: 800, quantity: 1 }),
    ]
    const rows = computeTopProducts(orders)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ name: 'Sneakers', category: 'Footwear', orders: 2, revenue: 4000, share: 83 })
    expect(rows[1]).toEqual({ name: 'Cap', category: 'Accessories', orders: 1, revenue: 800, share: 17 })
  })

  it('falls back to category when no product name is set', () => {
    const orders: OrderRow[] = [
      order({ id: 'o1', store_id: 's1', product_name: null, product_category: 'Apparel', price: 500, quantity: 1 }),
    ]
    const rows = computeTopProducts(orders)
    expect(rows[0].name).toBe('Apparel')
    expect(rows[0].category).toBe('Apparel')
  })
})