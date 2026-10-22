/* ============================================================
   ui/money.ts — PKR display, one way only.

   The app already formats money in lib/format.ts; this module adds
   the plain "PKR 8,400" form used by the new cards and the totals
   the dashboard shows. Numbers only ever come from loaded data.
   ============================================================ */

const pkr = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 })

/** PKR with thousands separators: 8400 -> "PKR 8,400". */
export function formatPKR(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return `PKR ${pkr.format(Math.round(Number(n)))}`
}

/** The number alone, no currency prefix, with separators. */
export function formatCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return pkr.format(Math.round(Number(n)))
}

/**
 * A one-line "N orders · PKR x" style fragment, skipping any part the
 * data does not have. Returns '' when there is nothing to say.
 */
export function sentence(parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => Boolean(p && String(p).trim())).join(' · ')
}

/**
 * How many units a row covers — and ZERO for a single unit.
 *
 * Callers use it both as a figure and as a condition (`units && …`), so "one
 * unit" has to read as nothing to say. That is why it is not `quantity ?? 1`:
 * a row labelled "1 units" is noise.
 */
export function orderUnits(quantity: number | null | undefined): number {
  const n = Math.round(Number(quantity ?? 1))
  return Number.isFinite(n) && n > 1 ? n : 0
}

/**
 * What the order is worth.
 *
 * `orders.price` already stores the ORDER total in both write paths: the
 * Shopify app writes `total_price`, and the CSV importer writes
 * `unit price × quantity`. Multiplying by quantity again would double-charge
 * every multi-item order — which is exactly what the dashboard used to do, and
 * why its revenue figures were inflated.
 */
export function orderTotal(
  price: number | null | undefined,
  _quantity?: number | null,
): number | null {
  return price == null || Number.isNaN(Number(price)) ? null : Number(price)
}

/** `orderTotal` for summing: a missing price contributes 0, never NaN. */
export function orderValue(price: number | null | undefined): number {
  return price == null || Number.isNaN(Number(price)) ? 0 : Number(price)
}

/**
 * Does this order count as money earned?
 *
 * Only a delivered order does. A refused COD parcel comes back, and one still
 * in transit has not been paid for. So `Revenue` moves when an outcome is
 * recorded, which is what a merchant expects to see after marking one.
 */
export function isDelivered(status: string | null | undefined): boolean {
  return status === 'accepted'
}
