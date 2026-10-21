/* ============================================================
   ui/aggregates.ts — the shape of the network aggregate results,
   and the guard that stops raw rows leaking through them.

   The edge function's aggregate tools no longer read the `orders`
   table. They call `verafo_aggregate_stats` and
   `verafo_buyer_ranking`, which compute in the database and return
   statistics only. This module is the tested contract for that
   boundary: what the columns mean, how they are rendered, and what
   must never appear.
   ============================================================ */

import { auditOutput } from './edge-authz'

/** A row from verafo_aggregate_stats. Statistics only - no identity. */
export interface AggregateRow {
  bucket: string
  orders: number
  buyers: number
  value: number
  accepted: number
  refused: number
  pending: number
  refusal_rate: number | null
}

/** A row from verafo_buyer_ranking. Ranked, masked, never identified. */
export interface BuyerRankRow {
  rank: number
  buyer_label: string
  orders: number
  accepted: number
  refused: number
  value: number
  risk_score: number | null
  store_count: number
}

/** The dimensions the aggregate function accepts. */
export const AGGREGATE_DIMENSIONS = ['city', 'product', 'category', 'reason', 'week'] as const
export type AggregateDimension = (typeof AGGREGATE_DIMENSIONS)[number]

/** The metrics verafo_buyer_ranking accepts. */
export const RANK_METRICS = ['orders', 'spend', 'refusals', 'risk'] as const
export type RankMetric = (typeof RANK_METRICS)[number]

/** An unknown dimension falls back to a safe total, never to raw rows. */
export function normalizeDimension(value: unknown): AggregateDimension {
  const v = String(value ?? '').toLowerCase().trim()
  return (AGGREGATE_DIMENSIONS as readonly string[]).includes(v) ? (v as AggregateDimension) : 'city'
}

export function normalizeMetric(value: unknown): RankMetric {
  const v = String(value ?? '').toLowerCase().trim()
  return (RANK_METRICS as readonly string[]).includes(v) ? (v as RankMetric) : 'orders'
}

/** Whole percent, or null when nothing resolved. Never rounds 0/0 into 0%. */
export function refusalPercent(rate: number | null | undefined): number | null {
  if (rate == null || !Number.isFinite(Number(rate))) return null
  return Math.round(Number(rate) * 100)
}

const n = (v: unknown): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Render an aggregate row for the assistant, with no identity fields. */
export function presentAggregate(row: AggregateRow): Record<string, unknown> {
  return {
    bucket: String(row.bucket ?? 'Unknown'),
    orders: n(row.orders),
    buyers: n(row.buyers),
    accepted: n(row.accepted),
    refused: n(row.refused),
    pending: n(row.pending),
    refusal_percent: refusalPercent(row.refusal_rate),
    value: Math.round(n(row.value)),
  }
}

/** Render a ranked buyer. The label is already masked by the database. */
export function presentBuyerRank(row: BuyerRankRow): Record<string, unknown> {
  return {
    rank: n(row.rank),
    buyer: String(row.buyer_label ?? '····'),
    orders: n(row.orders),
    accepted: n(row.accepted),
    refused: n(row.refused),
    value: Math.round(n(row.value)),
    risk_score: row.risk_score == null ? null : Number(row.risk_score),
    store_count: n(row.store_count),
  }
}

/**
 * Verify a batch of aggregate output is safe to hand to a merchant.
 *
 * Two checks: no forbidden field anywhere (embedding, feature_vector,
 * address, refusal_reason), and no full phone number in the ranking labels,
 * which must be masked.
 */
export function auditAggregateOutput(rows: unknown[]): {
  ok: boolean
  violations: string[]
} {
  const violations: string[] = []

  const audit = auditOutput(rows)
  violations.push(...audit.violations)

  const fullPhone = /\b(?:\+?92|0)\d{9,10}\b/
  rows.forEach((r, i) => {
    if (r && typeof r === 'object') {
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
        if (typeof v === 'string' && fullPhone.test(v.replace(/[^\d+]/g, ''))) {
          violations.push(`$[${i}].${k} looks like a full phone number`)
        }
      }
    }
  })

  return { ok: violations.length === 0, violations }
}

/**
 * The headline sentence for a refusal rate.
 * Below the minimum sample it refuses to state a rate at all.
 */
export function refusalHeadline(refused: number, resolved: number, minSample = 10): string {
  if (resolved < minSample) {
    return `Not enough resolved orders to state a rate (${resolved} of ${minSample} needed).`
  }
  const pct = Math.round((refused / resolved) * 100)
  return `${pct}% refused, from ${resolved} resolved orders.`
}
