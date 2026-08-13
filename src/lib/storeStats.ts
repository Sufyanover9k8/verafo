import type { DailySalesRow, OrderRow, StoreOverview } from './types'

export interface StoreLite {
  id: string
  name: string
  owner_email?: string | null
  created_at?: string | null
  shopify_domain?: string | null
}

/** Client-side equivalent of store_overview(): per-store aggregates from loaded orders. */
export function computeStoreOverview(orders: OrderRow[], stores: StoreLite[]): StoreOverview[] {
  const byStore = new Map<string, OrderRow[]>()
  for (const o of orders) {
    if (!o.store_id) continue
    const arr = byStore.get(o.store_id) ?? []
    arr.push(o)
    byStore.set(o.store_id, arr)
  }
  return stores.map((s) => {
    const os = byStore.get(s.id) ?? []
    const accepted = os.filter((o) => o.outcomes?.status === 'accepted').length
    const refused = os.filter((o) => o.outcomes?.status === 'refused').length
    const pending = os.filter((o) => !o.outcomes || o.outcomes.status === 'pending').length
    const revenue = os.reduce((sum, o) => sum + (o.price ?? 0) * (o.quantity ?? 1), 0)
    const buyers = new Set(os.map((o) => o.buyer_phone)).size
    const avgOrderValue = os.length ? Math.round(revenue / os.length) : 0
    const lastOrderAt = os.reduce<string | null>(
      (acc, o) => (o.ordered_at && (!acc || o.ordered_at > acc) ? o.ordered_at : acc),
      null,
    )
    return {
      id: s.id,
      name: s.name,
      shopify_domain: s.shopify_domain ?? null,
      owner_email: s.owner_email ?? null,
      created_at: s.created_at ?? null,
      orders: os.length,
      accepted,
      refused,
      pending,
      revenue,
      buyers,
      avg_order_value: avgOrderValue,
      last_order_at: lastOrderAt,
    }
  })
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** True when a store has no order, or none within the idle window. */
export function isIdleSince(lastOrderAt: string | null | undefined, days = 14): boolean {
  if (!lastOrderAt) return true
  return new Date().getTime() - new Date(lastOrderAt).getTime() > days * 86400000
}

/** Client-side equivalent of daily_sales(): gross sales (price × quantity) per local day. */
export function computeDailySales(orders: OrderRow[], days = 14): DailySalesRow[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const rows: DailySalesRow[] = []
  const map = new Map<string, DailySalesRow>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const iso = localDayKey(d)
    const row = { day: iso, orders: 0, revenue: 0 }
    rows.push(row)
    map.set(iso, row)
  }
  for (const o of orders) {
    if (!o.ordered_at) continue
    const iso = localDayKey(new Date(o.ordered_at))
    const row = map.get(iso)
    if (!row) continue
    row.orders++
    row.revenue += (o.price ?? 0) * (o.quantity ?? 1)
  }
  return rows
}

export interface CityStat {
  city: string
  orders: number
  revenue: number
  share: number
}

export interface ProductStat {
  name: string
  category: string | null
  orders: number
  revenue: number
  share: number
}

function normalizeCity(c: string | null | undefined): string {
  const t = (c ?? '').trim()
  if (!t) return 'Unknown'
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Revenue share of each city across the given orders, sorted by revenue. */
export function computeCityStats(orders: OrderRow[], limit = 8): CityStat[] {
  const byCity = new Map<string, { orders: number; revenue: number }>()
  for (const o of orders) {
    const city = normalizeCity(o.city)
    const entry = byCity.get(city) ?? { orders: 0, revenue: 0 }
    entry.orders++
    entry.revenue += (o.price ?? 0) * (o.quantity ?? 1)
    byCity.set(city, entry)
  }
  const total = [...byCity.values()].reduce((sum, e) => sum + e.revenue, 0) || 1
  return [...byCity.entries()]
    .map(([city, e]) => ({
      city,
      orders: e.orders,
      revenue: Math.round(e.revenue),
      share: Math.round((e.revenue / total) * 100),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
}

/** Top products by revenue across the given orders. */
export function computeTopProducts(orders: OrderRow[], limit = 6): ProductStat[] {
  const byName = new Map<string, { category: string | null; orders: number; revenue: number }>()
  for (const o of orders) {
    const name = o.product_name || o.product_category || 'Untitled product'
    const entry = byName.get(name) ?? { category: o.product_category ?? null, orders: 0, revenue: 0 }
    entry.orders++
    entry.revenue += (o.price ?? 0) * (o.quantity ?? 1)
    if (o.product_category) entry.category = o.product_category
    byName.set(name, entry)
  }
  const total = [...byName.values()].reduce((sum, e) => sum + e.revenue, 0) || 1
  return [...byName.entries()]
    .map(([name, e]) => ({
      name,
      category: e.category,
      orders: e.orders,
      revenue: Math.round(e.revenue),
      share: Math.round((e.revenue / total) * 100),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
}