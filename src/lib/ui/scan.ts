/* ============================================================
   ui/scan.ts — the historical order scan's logic.

   WHAT THIS IS
   A retrospective pass over orders the store already has. It groups
   them, counts what is known, and reports what the risk picture looks
   like *now*.

   WHAT THIS IS NOT
   It is not a claim that Verafo predicted these orders when they were
   placed, and it is not a claim that anything was prevented or saved.
   A score computed today, for an order placed months ago, is a
   retrospective view. Every label in this module says so, and the
   tests assert that no user-facing string claims otherwise.

   Pure functions only: no network, no database.
   ============================================================ */

import { rateOf, valueOf, MIN_SAMPLE, type ScoredOrder } from './analytics'

/** One batch's worth of work. */
export interface ScanBatch {
  index: number
  /** Inclusive row offset into the full set. */
  from: number
  /** Exclusive row offset. */
  to: number
}

/** Split a total into batches of at most `size`. */
export function planBatches(total: number, size = 50): ScanBatch[] {
  if (!Number.isFinite(total) || total <= 0) return []
  const step = Math.max(1, Math.floor(size))
  const batches: ScanBatch[] = []
  for (let from = 0; from < total; from += step) {
    batches.push({ index: batches.length, from, to: Math.min(from + step, total) })
  }
  return batches
}

/** 0–1, clamped. Used for the progress bar. */
export function progressOf(done: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  return Math.max(0, Math.min(1, done / total))
}

/** What a finished scan found. Every field is a count or an explicit null. */
export interface ScanSummary {
  /** Rows the scan looked at. */
  scanned: number
  /** Rows it could not use, and why. */
  skippedMissingPhone: number
  skippedMissingOutcome: number
  /** Orders whose buyer is scored at all. */
  scored: number
  /** Orders whose buyer has no resolved history, so no score exists. */
  unscored: number
  /** Highest-risk bucket, using the app's existing thresholds. */
  highRisk: number
  mediumRisk: number
  lowRisk: number
  /** Outcome counts. `unknown` is everything still pending or unrecorded. */
  accepted: number
  refused: number
  unknownOutcome: number
  /** Refusal rate over resolved orders only, or null. */
  refusalRate: number | null
  /** Sum of order value, or null when no order carried a price. */
  valueAtRisk: number | null
  /** Value of orders with a recorded refusal, or null. */
  refusedValue: number | null
  /** True when there were too few resolved orders to publish a rate. */
  rateWithheld: boolean
  /** Minimum sample the rate needed. */
  minSample: number
}

export interface ScanInput extends ScoredOrder {
  /** The buyer's risk score, when the app has one. */
  riskScore?: number | null
  /** Resolved orders on the buyer's profile. */
  buyerOrders?: number | null
  /** The order's buyer, for de-duplication. */
  buyer_phone?: string | null
}

/** Same thresholds as src/lib/risk.ts. Kept here so the scan is self-contained. */
function toneOf(score: number): 'safe' | 'watch' | 'high' {
  if (score < 0.45) return 'safe'
  if (score <= 0.65) return 'watch'
  return 'high'
}

/**
 * Summarise a set of orders.
 *
 * @param orders      rows already loaded and mapped
 * @param isScored    whether the buyer has enough history to be scored
 * @param missingPhone how many rows the caller had to drop for having no
 *                    usable phone number. Passed in because only the caller
 *                    can see the raw value.
 */
export function summariseScan(
  orders: ScanInput[],
  isScored: (o: ScanInput) => boolean = (o) => (o.buyerOrders ?? 0) >= 1,
  missingPhone = 0,
): ScanSummary {
  let scored = 0
  let unscored = 0
  let highRisk = 0
  let mediumRisk = 0
  let lowRisk = 0
  let skippedMissingOutcome = 0

  const forRate: ScoredOrder[] = []
  let refusedValue: number | null = null
  let atRiskValue: number | null = null

  for (const o of orders) {
    if (!o.outcome) skippedMissingOutcome++

    const known = isScored(o)
    if (known) {
      scored++
      const raw = Number(o.riskScore ?? 0.5)
      const tone = toneOf(Number.isFinite(raw) ? raw : 0.5)
      if (tone === 'high') highRisk++
      else if (tone === 'watch') mediumRisk++
      else lowRisk++
    } else {
      unscored++
    }

    forRate.push({ ...o, outcome: o.outcome ?? 'pending' })

    const v = valueOf([o])
    if (o.outcome === 'refused' && v != null) {
      refusedValue = (refusedValue ?? 0) + v
    }
    // Value still exposed: an order that has not resolved, from a buyer we
    // can actually judge. Value of unjudgeable orders is not "at risk".
    if (known && o.outcome !== 'accepted' && o.outcome !== 'refused' && v != null) {
      atRiskValue = (atRiskValue ?? 0) + v
    }
  }

  const rate = rateOf(forRate)

  return {
    scanned: orders.length,
    skippedMissingPhone: missingPhone,
    skippedMissingOutcome,
    scored,
    unscored,
    highRisk,
    mediumRisk,
    lowRisk,
    accepted: rate.accepted,
    refused: rate.refused,
    unknownOutcome: rate.unknown,
    refusalRate: rate.rate,
    valueAtRisk: atRiskValue,
    refusedValue,
    rateWithheld: !rate.confident && rate.resolved > 0,
    minSample: MIN_SAMPLE,
  }
}

/**
 * The headline sentence for a finished scan.
 *
 * Deliberately retrospective. It says the scores were worked out now, and
 * it never claims Verafo saw these orders coming or saved anything.
 */
export function scanHeadline(s: ScanSummary): string {
  if (s.scanned === 0) return 'No historical orders to scan.'
  const parts = [
    `Looked at ${s.scanned.toLocaleString('en-PK')} past order${s.scanned === 1 ? '' : 's'}.`,
    `${s.highRisk.toLocaleString('en-PK')} come from buyers who look HIGH RISK today.`,
  ]
  if (s.refused > 0) {
    parts.push(`${s.refused.toLocaleString('en-PK')} were refused at the door.`)
  }
  parts.push('These scores were worked out now — Verafo did not see these orders when they were placed.')
  return parts.join(' ')
}

/**
 * The limitations a merchant must read before trusting the scan.
 * Shown with the results, not hidden behind a disclosure.
 */
export function scanCaveats(s: ScanSummary): string[] {
  const out: string[] = [
    'Scores are worked out from today’s buyer history. They are not the scores that existed when these orders were placed, and Verafo did not prevent any of them.',
  ]
  if (s.unscored > 0) {
    out.push(
      `${s.unscored.toLocaleString('en-PK')} order${s.unscored === 1 ? '' : 's'} have a buyer with no resolved history, so no score exists for them. That is missing information, not a risk signal.`,
    )
  }
  if (s.unknownOutcome > 0) {
    out.push(
      `${s.unknownOutcome.toLocaleString('en-PK')} order${s.unknownOutcome === 1 ? '' : 's'} still have no recorded outcome. They are left out of the refusal rate.`,
    )
  }
  if (s.rateWithheld) {
    out.push(
      `Fewer than ${s.minSample} orders have a resolved outcome, so no refusal rate is published.`,
    )
  }
  if (s.refusedValue != null) {
    out.push('Order value is not profit. It is what the parcel was worth, not what it cost you.')
  }
  return out
}

/**
 * A stable key for de-duplication, so re-running a scan does not count the
 * same order twice.
 */
export function scanKey(o: { id?: string; ordered_at?: string | null; buyer_phone?: string | null }): string {
  if (o.id) return String(o.id)
  return `${o.buyer_phone ?? ''}|${o.ordered_at ?? ''}`
}

/** Remove rows a previous scan already counted. */
export function dedupeScanned<T extends { id?: string; ordered_at?: string | null; buyer_phone?: string | null }>(
  rows: T[],
  alreadySeen: Set<string>,
): T[] {
  const out: T[] = []
  const seenNow = new Set<string>()
  for (const r of rows) {
    const k = scanKey(r)
    if (alreadySeen.has(k) || seenNow.has(k)) continue
    seenNow.add(k)
    out.push(r)
  }
  return out
}
