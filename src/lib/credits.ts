import { supabase } from './supabase'

/**
 * Plan credits, as the merchant sees them.
 *
 * One buyer check is one credit. One minute of an AI call is one credit,
 * rounded up. A store's allowance is its plan's included credits plus the
 * overage it is allowed to run into; anything beyond that stops the work.
 */
export interface CreditStatus {
  planCode: string
  planName: string
  included: number
  overageAllowed: number
  used: number
  remaining: number
  overage: number
  overageRate: number
  pricePkr: number
  cycleEnd: string | null
}

/** What a store with no plan row gets: the free tier. */
export const FREE_STATUS: CreditStatus = {
  planCode: 'free',
  planName: 'Free',
  included: 100,
  overageAllowed: 0,
  used: 0,
  remaining: 100,
  overage: 0,
  overageRate: 0,
  pricePkr: 0,
  cycleEnd: null,
}

interface StatusRow {
  plan_code?: string | null
  plan_name?: string | null
  included_credits?: number | string | null
  overage_allowed?: number | string | null
  used_credits?: number | string | null
  remaining_credits?: number | string | null
  overage_credits?: number | string | null
  overage_pkr_per_credit?: number | string | null
  price_pkr?: number | string | null
  cycle_end?: string | null
}

function toStatus(row: StatusRow): CreditStatus {
  return {
    planCode: String(row.plan_code ?? 'free'),
    planName: String(row.plan_name ?? 'Free'),
    included: Number(row.included_credits ?? 0),
    overageAllowed: Number(row.overage_allowed ?? 0),
    used: Number(row.used_credits ?? 0),
    remaining: Number(row.remaining_credits ?? 0),
    overage: Number(row.overage_credits ?? 0),
    overageRate: Number(row.overage_pkr_per_credit ?? 0),
    pricePkr: Number(row.price_pkr ?? 0),
    cycleEnd: row.cycle_end ?? null,
  }
}

export async function readCreditStatus(storeId: string | null | undefined): Promise<CreditStatus | null> {
  if (!storeId || !supabase) return null
  const { data, error } = await supabase.rpc('store_credit_status', { p_store: storeId })
  if (error) return null
  const row = (Array.isArray(data) ? data[0] : data) as StatusRow | null
  return row ? toStatus(row) : null
}

/** One figure for the rail: summed across the stores in scope. */
export async function readCreditsForStores(
  storeIds: string[] | null | undefined,
): Promise<CreditStatus | null> {
  const ids = (storeIds ?? []).filter(Boolean)
  if (!ids.length) return null

  const rows = await Promise.all(ids.map((id) => readCreditStatus(id)))
  const live = rows.filter((r): r is CreditStatus => Boolean(r))
  if (!live.length) return null
  if (live.length === 1) return live[0]

  return live.reduce<CreditStatus>(
    (sum, s) => ({
      planCode: 'mixed',
      planName: `${live.length} stores`,
      included: sum.included + s.included,
      overageAllowed: sum.overageAllowed + s.overageAllowed,
      used: sum.used + s.used,
      remaining: sum.remaining + s.remaining,
      overage: sum.overage + s.overage,
      overageRate: s.overageRate,
      pricePkr: sum.pricePkr + s.pricePkr,
      cycleEnd: s.cycleEnd ?? sum.cycleEnd,
    }),
    { ...FREE_STATUS, planCode: 'mixed', planName: `${live.length} stores`, included: 0, overageAllowed: 0, used: 0, remaining: 0, overage: 0, pricePkr: 0 },
  )
}

/** "Free · 40 of 100 credits used this month". */
export function describeCredits(c: CreditStatus | null): string {
  if (!c) return 'Credits unavailable'
  const used = Math.round(c.used).toLocaleString()
  const total = Math.round(c.included + c.overageAllowed).toLocaleString()
  return `${c.planName} · ${used} of ${total} credits used`
}
