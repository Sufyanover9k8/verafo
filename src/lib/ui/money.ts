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
