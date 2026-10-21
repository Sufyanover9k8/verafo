/* ============================================================
   ui/order-sort.ts — how the order list is ordered.

   The list arrives newest-first from the query, and that stays the default.
   A merchant who wants something else picks it from one list, so the rules
   live here rather than inside the page.

   There is deliberately no "buyer A–Z": Verafo stores a buyer as a phone
   number and a score, with no name to sort on. A phone number is the
   tie-break where one is needed.
   ============================================================ */

export type SortKey = 'new-to-old' | 'old-to-new' | 'amount-high' | 'amount-low' | 'risk-high' | 'status'

/** The choices offered, in the order they appear. */
export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'new-to-old', label: 'New to old' },
  { value: 'old-to-new', label: 'Old to new' },
  { value: 'amount-high', label: 'Amount — high to low' },
  { value: 'amount-low', label: 'Amount — low to high' },
  { value: 'risk-high', label: 'Risk — high to low' },
  { value: 'status', label: 'Status — to-do first' },
]

/** The fields each rule reads, so the sort stays easy to follow. */
export interface SortableOrder {
  buyer_phone: string
  ordered_at: string | null
  price: number | null
  quantity: number | null
  outcomes?: { status: string | null } | null
  buyers?: { risk_score: number | null } | null
}

/** The order's value: unit price × quantity, as the Amount column shows it. */
export function orderAmount(o: SortableOrder): number {
  return (o.price ?? 0) * (o.quantity ?? 1)
}

/**
 * Triage order for the Status rule: what still needs a decision comes first,
 * then what went wrong, then what is settled. A merchant sorting by status is
 * looking for work to do, not for a tidy alphabetical list.
 */
const STATUS_RANK: Record<string, number> = { pending: 0, refused: 1, accepted: 2 }

export function statusRank(o: SortableOrder): number {
  return STATUS_RANK[o.outcomes?.status ?? 'pending'] ?? 0
}

/** Timestamps, or 0 for a missing date so it sorts as the oldest thing there is. */
function timeOf(o: SortableOrder): number {
  return o.ordered_at ? new Date(o.ordered_at).getTime() : 0
}

/**
 * Order two rows.
 *
 * "New to old" puts the LARGEST date first, so the most recent order is the
 * top row of the table. "Old to new" puts the smallest date first. The sort
 * compares timestamps directly — never the formatted date text, and never the
 * order the rows happen to arrive in.
 *
 * Every rule falls back to the phone number, so two orders placed in the same
 * second keep a stable order instead of shuffling between renders.
 *
 * An order with no date, no price, or a buyer with no score is treated as the
 * smallest value. In a "high to low" sort that puts the unknowns last, where
 * they belong, rather than at the top on a technicality.
 */
export function compareOrders(a: SortableOrder, b: SortableOrder, key: SortKey): number {
  const at = timeOf(a)
  const bt = timeOf(b)
  const byPhone = a.buyer_phone.localeCompare(b.buyer_phone)

  switch (key) {
    case 'old-to-new':
      // An unknown date is not "oldest", so it goes last rather than leading.
      return (at || Infinity) - (bt || Infinity) || byPhone
    case 'amount-high':
      return orderAmount(b) - orderAmount(a) || bt - at
    case 'amount-low':
      return orderAmount(a) - orderAmount(b) || bt - at
    case 'risk-high': {
      const ar = a.buyers?.risk_score ?? -1
      const br = b.buyers?.risk_score ?? -1
      return br - ar || bt - at
    }
    case 'status':
      return statusRank(a) - statusRank(b) || bt - at
    case 'new-to-old':
    default:
      return bt - at || byPhone
  }
}

/** A sorted copy — the caller's array is never reordered in place. */
export function sortOrders<T extends SortableOrder>(orders: T[], key: SortKey): T[] {
  return [...orders].sort((a, b) => compareOrders(a, b, key))
}
