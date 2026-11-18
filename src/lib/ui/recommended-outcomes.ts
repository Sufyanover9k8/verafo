/* ============================================================
   recommended-outcomes.ts — which pending orders Verafo would
   clear itself.

   The rule is deliberately conservative: only an order whose buyer
   has a *scored* LOW RISK verdict qualifies. A buyer with no
   resolved history (UNKNOWN) is never auto-accepted, because
   "no data" is not "safe" — that distinction is the product.
   ============================================================ */

import { hasEnoughData, toneFromScore } from '../risk'

export interface OutcomeCandidate {
  outcomes?: { status?: string | null } | null
  buyers?: { risk_score?: number | null; total_orders?: number | null } | null
}

/** Pending = no outcome row yet, or an outcome that is still pending. */
export function isPending(order: OutcomeCandidate): boolean {
  const status = order.outcomes?.status
  return !status || status === 'pending'
}

/**
 * Verafo's automatic verdict for one order: accept only scored low risk.
 * Medium, high and unknown all stay with the merchant.
 */
export function isRecommendedAcceptance(order: OutcomeCandidate): boolean {
  if (!isPending(order)) return false
  const buyer = order.buyers
  if (!buyer) return false
  if (!hasEnoughData(buyer.total_orders)) return false
  const score = Number(buyer.risk_score ?? 1)
  if (!Number.isFinite(score)) return false
  return toneFromScore(score) === 'safe'
}

/** The subset of `orders` that "Do recommended" would accept. */
export function recommendedAcceptances<T extends OutcomeCandidate>(orders: T[]): T[] {
  return orders.filter(isRecommendedAcceptance)
}
