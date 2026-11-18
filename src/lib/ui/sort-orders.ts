/* ============================================================
   sort-orders.ts — how the Orders table can be ordered.

   Kept pure so the ordering rules are testable without a table:
   an UNKNOWN risk score is never treated as "low risk", and a
   missing amount sorts last in both directions instead of jumping
   to the top.
   ============================================================ */

import { hasEnoughData } from '../risk'

export type OrderSortKey =
  | 'date_desc'
  | 'date_asc'
  | 'risk_desc'
  | 'risk_asc'
  | 'amount_desc'
  | 'amount_asc'
  | 'buyer_asc'
  | 'status_pending'

export const ORDER_SORTS: { key: OrderSortKey; label: string }[] = [
  { key: 'date_desc', label: 'Newest first' },
  { key: 'date_asc', label: 'Oldest first' },
  { key: 'risk_desc', label: 'Highest risk' },
  { key: 'risk_asc', label: 'Lowest risk' },
  { key: 'amount_desc', label: 'Highest amount' },
  { key: 'amount_asc', label: 'Lowest amount' },
  { key: 'buyer_asc', label: 'Buyer number' },
  { key: 'status_pending', label: 'Needs a decision' },
]

export interface SortableOrder {
  ordered_at: string | null
  price: number | string | null
  quantity: number | null
  buyer_phone: string | null
  outcomes?: { status?: string | null } | null
  buyers?: { risk_score?: number | null; total_orders?: number | null } | null
}

/** Epoch milliseconds; a missing or invalid date sorts as oldest. */
function stamp(order: SortableOrder): number {
  const t = order.ordered_at ? new Date(order.ordered_at).getTime() : NaN
  return Number.isNaN(t) ? 0 : t
}

function amount(order: SortableOrder): number {
  // A courier-imported order may genuinely have no price. That is "unknown",
  // not zero, so it belongs at the end rather than looking like the cheapest.
  if (order.price === null || order.price === undefined || order.price === '') return Number.NaN
  const price = typeof order.price === 'string' ? Number(order.price) : order.price
  const quantity = Number(order.quantity ?? 1)
  if (!Number.isFinite(price)) return Number.NaN
  return price * (Number.isFinite(quantity) && quantity > 0 ? quantity : 1)
}

/** Only a buyer with resolved history has a usable score. */
function score(order: SortableOrder): number | null {
  const buyer = order.buyers
  if (!buyer || !hasEnoughData(buyer.total_orders)) return null
  const value = Number(buyer.risk_score)
  return Number.isFinite(value) ? value : null
}

export function sortOrders<T extends SortableOrder>(rows: T[], key: OrderSortKey): T[] {
  const copy = [...rows]

  switch (key) {
    case 'date_asc':
      return copy.sort((a, b) => stamp(a) - stamp(b))
    case 'date_desc':
      return copy.sort((a, b) => stamp(b) - stamp(a))
    case 'risk_desc':
      // Unscored buyers (no resolved history) go last: "no data" is not "safe".
      return copy.sort((a, b) => {
        const sa = score(a)
        const sb = score(b)
        if (sa === null && sb === null) return stamp(b) - stamp(a)
        if (sa === null) return 1
        if (sb === null) return -1
        return sb - sa || stamp(b) - stamp(a)
      })
    case 'risk_asc':
      return copy.sort((a, b) => {
        const sa = score(a)
        const sb = score(b)
        if (sa === null && sb === null) return stamp(b) - stamp(a)
        if (sa === null) return 1
        if (sb === null) return -1
        return sa - sb || stamp(b) - stamp(a)
      })
    case 'amount_desc':
      return copy.sort((a, b) => {
        const aa = amount(a)
        const ab = amount(b)
        if (!Number.isFinite(aa) && !Number.isFinite(ab)) return stamp(b) - stamp(a)
        if (!Number.isFinite(aa)) return 1
        if (!Number.isFinite(ab)) return -1
        return ab - aa || stamp(b) - stamp(a)
      })
    case 'amount_asc':
      return copy.sort((a, b) => {
        const aa = amount(a)
        const ab = amount(b)
        if (!Number.isFinite(aa) && !Number.isFinite(ab)) return stamp(b) - stamp(a)
        if (!Number.isFinite(aa)) return 1
        if (!Number.isFinite(ab)) return -1
        return aa - ab || stamp(b) - stamp(a)
      })
    case 'buyer_asc':
      return copy.sort(
        (a, b) => (a.buyer_phone ?? '').localeCompare(b.buyer_phone ?? '', undefined, { numeric: true }),
      )
    case 'status_pending': {
      const rank = (order: SortableOrder) => {
        const s = order.outcomes?.status ?? 'pending'
        return s === 'pending' ? 0 : 1
      }
      return copy.sort((a, b) => rank(a) - rank(b) || stamp(b) - stamp(a))
    }
    default:
      return copy
  }
}

