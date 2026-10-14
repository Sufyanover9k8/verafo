/* ============================================================
   ui/decisions.ts — the Decide Queue's logic.

   Pure functions only: no network, no database. The page supplies
   data, these decide what to show and what is allowed.

   The rule this file exists to protect: a merchant *decision* is not
   a delivery *outcome*. Choosing "ship" does NOT mark an order
   delivered, accepted or refused, and must never trigger fulfillment.
   ============================================================ */

export const DECISIONS = ['confirm_whatsapp', 'call', 'hold', 'ship'] as const
export type Decision = (typeof DECISIONS)[number]

export interface DecisionMeta {
  /** Button label. */
  label: string
  /** One plain line explaining what it does. */
  help: string
  /** Visual weight. `ship` is deliberately not styled as the safe choice. */
  weight: 'neutral' | 'caution'
}

export const DECISION_META: Record<Decision, DecisionMeta> = {
  confirm_whatsapp: {
    label: 'Confirm on WhatsApp',
    help: 'Opens WhatsApp with a message asking the buyer to confirm. Nothing is sent by Verafo.',
    weight: 'neutral',
  },
  call: {
    label: 'Call buyer',
    help: 'Opens your phone app with this number.',
    weight: 'neutral',
  },
  hold: {
    label: 'Hold for review',
    help: 'Parks the order for later. The order itself does not change.',
    weight: 'neutral',
  },
  ship: {
    label: 'Ship anyway',
    help: 'Records that you are shipping despite the risk. This does not fulfil or deliver the order.',
    weight: 'caution',
  },
}

/** What Verafo suggests, and why. Never presented as an instruction. */
export interface Recommendation {
  decision: Decision
  /** The single sentence shown to the merchant. */
  reason: string
  tone: 'safe' | 'watch' | 'high' | 'unknown'
}

export interface RecommendInput {
  /** 0–1, or null when there is not enough history. */
  riskScore?: number | null
  /** Resolved orders on the buyer's network profile. */
  totalOrders?: number | null
  totalRefused?: number | null
  /** Order value, when the order carries a price. */
  amount?: number | null
}

/** Matches MIN_SCORED in lib/risk.ts: one resolved order is enough to be scored. */
const MIN_SCORED = 1
/** Matches MIN_ORDERS in lib/risk.ts: three is where the readout is confident. */
const CONFIDENT_ORDERS = 3

/**
 * Suggest one next step.
 *
 * A buyer with too little history is never called fraudulent. The
 * recommendation is to confirm, and the sentence says plainly that thin
 * history is not evidence of anything.
 */
export function recommend(input: RecommendInput): Recommendation {
  const orders = Math.max(0, Number(input.totalOrders ?? 0) || 0)
  const score = input.riskScore == null ? null : Number(input.riskScore)

  if (orders < MIN_SCORED || score == null || !Number.isFinite(score)) {
    return {
      decision: 'confirm_whatsapp',
      tone: 'unknown',
      reason:
        'No resolved orders for this buyer yet, so there is nothing to judge. That is not a sign of fraud — confirm the order before you ship.',
    }
  }

  const thin = orders < CONFIDENT_ORDERS
  const thinNote = thin ? ' Only a little history so far, so treat this as an early signal.' : ''

  if (score > 0.65) {
    return {
      decision: 'confirm_whatsapp',
      tone: 'high',
      reason: `This buyer looks high risk (${score.toFixed(2)} of 1). Confirm before you ship.${thinNote}`,
    }
  }
  if (score >= 0.45) {
    return {
      decision: 'confirm_whatsapp',
      tone: 'watch',
      reason: `This buyer looks medium risk (${score.toFixed(2)} of 1). A quick confirmation is worth it.${thinNote}`,
    }
  }
  return {
    decision: 'ship',
    tone: 'safe',
    reason: `This buyer looks low risk (${score.toFixed(2)} of 1) with ${orders} resolved order${orders === 1 ? '' : 's'}.${thinNote}`,
  }
}

export interface DecisionRecord {
  id: string
  order_id: string
  decision: Decision
  actor_email: string | null
  note: string | null
  created_at: string
}

/** The newest decision per order, keyed by order id. */
export function latestByOrder(rows: DecisionRecord[]): Map<string, DecisionRecord> {
  const out = new Map<string, DecisionRecord>()
  for (const r of rows) {
    const seen = out.get(r.order_id)
    if (!seen || new Date(r.created_at).getTime() > new Date(seen.created_at).getTime()) {
      out.set(r.order_id, r)
    }
  }
  return out
}

/**
 * Is this order still worth a look?
 *
 * Deliberately based on the decision only. A "hold" or a "ship" keeps the
 * order in the queue off the *pending* list, but recording a decision never
 * resolves the order — only a real outcome does.
 */
export function needsDecision(decision: Decision | null | undefined): boolean {
  return decision == null
}

/** A decision's effect on the queue, in plain words. */
export function decisionLabel(d: Decision | null | undefined): string | null {
  if (!d) return null
  return DECISION_META[d].label
}

/**
 * Validate a decision before it is written. Returns an error sentence, or
 * null when it is fine. Keeps bad input out of the database and mirrors the
 * table's own check constraint.
 */
export function validateDecision(input: {
  decision: unknown
  orderId: unknown
  actorEmail: unknown
  note?: unknown
}): string | null {
  if (typeof input.orderId !== 'string' || !input.orderId.trim()) return 'Missing order.'
  if (!DECISIONS.includes(input.decision as Decision)) return 'Unknown decision.'
  if (typeof input.actorEmail !== 'string' || !input.actorEmail.trim()) {
    return 'You need to be signed in to record a decision.'
  }
  if (input.note != null && String(input.note).length > 500) {
    return 'Notes must be 500 characters or less.'
  }
  return null
}
