/* ============================================================
   ui/simulate.ts — the What-if Rule Simulator.

   WHAT IT ANSWERS
   "If I hid cash on delivery above this risk score, how many of my
   past orders would that have affected, and what were those orders
   actually worth?"

   WHAT IT IS NOT
   · It is not a prediction. It re-reads history under a hypothetical
     rule and counts what would have matched.
   · It is not a saving. Order value is what the parcel was worth, not
     profit, and nothing here is money recovered.
   · It never writes anything.

   READ-ONLY BY CONSTRUCTION: this module has no database client, no
   fetch and no imports beyond the analytics helpers. It receives plain
   objects and returns plain objects. The tests assert that it leaves
   its input untouched, and they assert the module's own source imports
   nothing that could write.

   Thresholds are imported from the single source of truth in
   lib/risk.ts, never re-declared, so the simulator can never drift
   from the score the product actually uses.
   ============================================================ */

import { toneFromScore, hasEnoughData } from '../risk'
import { valueOf, type ScoredOrder } from './analytics'

/** The rules a merchant can explore. All are hypothetical. */
export interface SimRules {
  /** Hide COD at or above this risk score. 0.45–0.95. */
  scoreThreshold: number
  /** Also require a confirmation when the order is worth at least this much. */
  valueThreshold: number | null
  /** Count buyers with too little history as needing confirmation. */
  includeUnknown: boolean
}

export interface SimOrder extends ScoredOrder {
  /** The buyer's risk score, when a score exists. */
  riskScore?: number | null
  /** Resolved orders on the buyer's profile. */
  buyerOrders?: number | null
}

export const DEFAULT_RULES: SimRules = {
  scoreThreshold: 0.45,
  valueThreshold: null,
  includeUnknown: false,
}

export const RULE_BOUNDS = {
  scoreThreshold: { min: 0.45, max: 0.95, step: 0.05 },
  valueThreshold: { min: 0, max: 100000, step: 500 },
} as const

export function clampRules(rules: SimRules): SimRules {
  const b = RULE_BOUNDS.scoreThreshold
  const score = Number.isFinite(rules.scoreThreshold) ? rules.scoreThreshold : DEFAULT_RULES.scoreThreshold
  const value =
    rules.valueThreshold == null || !Number.isFinite(rules.valueThreshold)
      ? null
      : Math.max(0, Math.min(RULE_BOUNDS.valueThreshold.max, rules.valueThreshold))
  return {
    scoreThreshold: Math.max(b.min, Math.min(b.max, score)),
    valueThreshold: value,
    includeUnknown: Boolean(rules.includeUnknown),
  }
}

/** Why one order was picked up by the rule. */
export type SimReason = 'score' | 'value' | 'unknown' | null

export interface SimOrderResult {
  id: string
  /** True when the hypothetical rule would have applied to this order. */
  affected: boolean
  reason: SimReason
  /** Whether the buyer could be scored at all. */
  scored: boolean
  /** Order value, or null when no price was recorded. */
  value: number | null
  /** What actually happened, from `outcomes`. Never changed by this module. */
  outcome: 'accepted' | 'refused' | 'pending' | null
}

export interface SimBucket {
  /** Orders the rule would have applied to. */
  orders: number
  /** Of those, how many actually resolved. */
  resolved: number
  accepted: number
  refused: number
  /** Of those, how many still have no recorded outcome. */
  unknown: number
  /** Value of the affected orders, or null when none carried a price. */
  value: number | null
  /** refused / resolved, or null. */
  refusalRate: number | null
}

export interface SimResult {
  /** Orders the rule would have applied to. */
  affected: SimBucket
  /** Orders the rule would have left alone. */
  untouched: SimBucket
  /** Every order considered. */
  total: number
  /** Orders with no price recorded, so value figures exclude them. */
  withoutPrice: number
  /** Buyers with too little history to be scored. */
  unscored: number
  /** Share of the dataset affected, 0–1. */
  share: number
  /** True when the sample is too small to read anything into. */
  tooSmall: boolean
  /** Minimum sample the app uses before it will quote a rate. */
  minSample: number
}

function emptyBucket(): SimBucket {
  return { orders: 0, resolved: 0, accepted: 0, refused: 0, unknown: 0, value: null, refusalRate: null }
}

function addToBucket(b: SimBucket, r: SimOrderResult): void {
  b.orders++
  if (r.value != null) b.value = (b.value ?? 0) + r.value
  if (r.outcome === 'accepted') {
    b.accepted++
    b.resolved++
  } else if (r.outcome === 'refused') {
    b.refused++
    b.resolved++
  } else {
    b.unknown++
  }
}

function finishBucket(b: SimBucket): SimBucket {
  return { ...b, refusalRate: b.resolved > 0 ? b.refused / b.resolved : null }
}

export const MIN_SAMPLE = 10

/**
 * Decide whether the hypothetical rule would catch one order.
 * Split out so the UI can explain the reason per order without
 * recomputing anything.
 */
export function affectedBy(rules: SimRules, o: SimOrder): { affected: boolean; reason: SimReason } {
  const scaled = o.buyerOrders ?? 0
  const scored = hasEnoughData(scaled)

  // No usable score: only caught when the merchant opts in, and clearly
  // labelled as "unknown" rather than as a risk finding.
  if (!scored || o.riskScore == null || !Number.isFinite(Number(o.riskScore))) {
    return rules.includeUnknown ? { affected: true, reason: 'unknown' } : { affected: false, reason: null }
  }

  const score = Number(o.riskScore)

  if (score >= rules.scoreThreshold) return { affected: true, reason: 'score' }

  if (rules.valueThreshold != null) {
    const v = valueOf([o])
    if (v != null && v >= rules.valueThreshold) return { affected: true, reason: 'value' }
  }

  return { affected: false, reason: null }
}

/**
 * Run one hypothetical rule over a set of orders.
 *
 * Pure: the input array and its objects are never modified. The tests
 * deep-freeze the input and compare it before and after.
 */
export function simulate(orders: SimOrder[], rawRules: SimRules): SimResult {
  const rules = clampRules(rawRules)

  const affected = emptyBucket()
  const untouched = emptyBucket()
  let withoutPrice = 0
  let unscored = 0

  for (const o of orders) {
    const scored = hasEnoughData(o.buyerOrders ?? 0)
    if (!scored) unscored++

    const value = valueOf([o])
    if (value == null) withoutPrice++

    const { affected: hit, reason } = affectedBy(rules, o)
    const result: SimOrderResult = {
      id: String(o.id),
      affected: hit,
      reason,
      scored,
      value,
      outcome: (o.outcome as SimOrderResult['outcome']) ?? null,
    }

    addToBucket(hit ? affected : untouched, result)
  }

  const total = orders.length
  return {
    affected: finishBucket(affected),
    untouched: finishBucket(untouched),
    total,
    withoutPrice,
    unscored,
    share: total > 0 ? affected.orders / total : 0,
    tooSmall: affected.resolved < MIN_SAMPLE,
    minSample: MIN_SAMPLE,
  }
}

/** A rule change expressed against the app's real colour bands. */
export function bandOf(score: number): 'safe' | 'watch' | 'high' {
  // toneFromScore can return 'unknown', but the simulator only reaches this
  // with a score the buyer actually has, so the narrow type is safe here.
  return toneFromScore(score) as 'safe' | 'watch' | 'high'
}

/**
 * The band the threshold currently sits in, in plain words, so the
 * merchant knows what they are actually turning off.
 */
export function thresholdExplanation(score: number): string {
  const band = bandOf(score)
  if (band === 'safe') {
    return `Hiding cash on delivery at ${score.toFixed(2)} also affects buyers Verafo calls LOW RISK. That is a strict rule.`
  }
  if (band === 'watch') {
    return `Hiding cash on delivery at ${score.toFixed(2)} affects MEDIUM RISK buyers and above.`
  }
  return `Hiding cash on delivery at ${score.toFixed(2)} affects only HIGH RISK buyers. That is a narrow rule.`
}

/**
 * Honest summary lines for a result. Every line is phrased as a
 * hypothetical, and none of them claims a saving or a prevention.
 */
export function explainResult(r: SimResult, rules: SimRules): string[] {
  const out: string[] = []
  if (r.total === 0) {
    return ['There are no orders to test this rule against yet.']
  }

  out.push(
    `Out of ${r.total.toLocaleString('en-PK')} orders, this rule would have applied to ${r.affected.orders.toLocaleString('en-PK')} (${Math.round(r.share * 100)}%).`,
  )

  if (r.affected.value != null) {
    out.push(
      `Those orders were worth ${Math.round(r.affected.value).toLocaleString('en-PK')} PKR in total. That is order value, not profit, and not money recovered.`,
    )
  }

  if (r.affected.refused > 0) {
    out.push(`${r.affected.refused.toLocaleString('en-PK')} of them were actually refused at the door.`)
  }
  if (r.affected.accepted > 0) {
    out.push(
      `${r.affected.accepted.toLocaleString('en-PK')} were accepted — a strict rule would have asked those buyers to pay upfront for no reason.`,
    )
  }
  if (r.affected.unknown > 0) {
    out.push(`${r.affected.unknown.toLocaleString('en-PK')} still have no recorded outcome, so they cannot be judged either way.`)
  }

  if (r.tooSmall) {
    out.push(
      `Only ${r.affected.resolved} affected orders have a resolved outcome. Verafo will not draw a conclusion below ${r.minSample}, so treat this as a rough shape, not a result.`,
    )
  } else if (r.affected.refusalRate != null) {
    out.push(
      `Of the affected orders that resolved, ${Math.round(r.affected.refusalRate * 100)}% were refused, against ${r.untouched.refusalRate == null ? 'an unknown rate' : `${Math.round(r.untouched.refusalRate * 100)}%`} in the orders you would leave alone.`,
    )
  }

  if (r.withoutPrice > 0) {
    out.push(`${r.withoutPrice.toLocaleString('en-PK')} orders have no price recorded, so value figures leave them out.`)
  }
  if (r.unscored > 0) {
    out.push(
      `${r.unscored.toLocaleString('en-PK')} orders belong to buyers with too little history to score. ${rules.includeUnknown ? 'You chose to include them.' : 'They are left out of the affected count.'}`,
    )
  }

  out.push('This is a hypothetical. Nothing has been changed, and no rule is enforced.')
  return out
}
