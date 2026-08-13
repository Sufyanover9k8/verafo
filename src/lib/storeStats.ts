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