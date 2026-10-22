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
 * `orders.price` already stores the LINE total (unit price × quantity) — that
 * is what the importer writes and what the Orders table displays. Multiplying
 * by quantity here would double-charge every multi-item order, so this
 * multiplies nothing: it exists so a caller cannot get that wrong, and keeps a
 * null price null instead of turning it into 0.
 */
export function orderTotal(
  price: number | null | undefined,
  _quantity?: number | null,
): number | null {
  return price == null || Number.isNaN(Number(price)) ? null : Number(price)
}
