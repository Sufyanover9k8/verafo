import { supabase } from './supabase'

/**
 * Plan credits, as the merchant sees them.
 *
 * One buyer check is one credit. One minute of an AI call is one credit,
 * rounded up. A plan packages a number of credits a month; a paid plan keeps
 * working past them and bills each extra credit at the plan rate, which is why
 * only the free plan ever runs out.
 */
export interface CreditStatus {
  planCode: string
  planName: string
  /** Credits the plan packages each month. */
  included: number
  /** Credits used this cycle, checks and call minutes together. */
  used: number
  /** Packaged credits left; zero once the plan is into overage. */
  remaining: number
  /** Credits above the package, billed at `overageRate`. */
  overage: number
  overageRate: number
  /** Paid plans may overspend their package; the free plan may not. */
  allowOverage: boolean
  pricePkr: number
  cycleEnd: string | null
}

/** What a store with no plan row gets: the free tier. */
export const FREE_STATUS: CreditStatus = {
  planCode: 'free',
  planName: 'Free',
  included: 100,
  used: 0,
  remaining: 100,
  overage: 0,
  overageRate: 0,
  allowOverage: false,
  pricePkr: 0,
  cycleEnd: null,
}

interface StatusRow {
  plan_code?: string | null
  plan_name?: string | null
  included_credits?: number | string | null
  used_credits?: number | string | null
  remaining_credits?: number | string | null
  overage_credits?: number | string | null
  overage_pkr_per_credit?: number | string | null
  allow_overage?: boolean | null
  price_pkr?: number | string | null
  cycle_end?: string | null
}

function toStatus(row: StatusRow): CreditStatus {
  return {
    planCode: String(row.plan_code ?? 'free'),
    planName: String(row.plan_name ?? 'Free'),
    included: Number(row.included_credits ?? 0),
    used: Number(row.used_credits ?? 0),
    remaining: Number(row.remaining_credits ?? 0),
    overage: Number(row.overage_credits ?? 0),
    overageRate: Number(row.overage_pkr_per_credit ?? 0),
    allowOverage: Boolean(row.allow_overage),
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
    (acc, s) => ({
      ...acc,
      included: acc.included + s.included,
      used: acc.used + s.used,
      remaining: acc.remaining + s.remaining,
      overage: acc.overage + s.overage,
      pricePkr: acc.pricePkr + s.pricePkr,
      allowOverage: acc.allowOverage || s.allowOverage,
      cycleEnd: acc.cycleEnd ?? s.cycleEnd,
    }),
    {
      ...FREE_STATUS,
      planCode: 'mixed',
      planName: `${live.length} stores`,
      included: 0,
      used: 0,
      remaining: 0,
      overage: 0,
      pricePkr: 0,
      overageRate: live[0].overageRate,
    },
  )
}

/** May this store spend another credit? Free stops at zero; paid does not. */
export function canSpend(c: CreditStatus | null): boolean {
  if (!c) return true
  return c.allowOverage || c.remaining >= 1
}

/** PKR owed for the credits above the package. */
export function overagePkr(c: CreditStatus | null): number {
  if (!c) return 0
  return Math.round(Math.max(0, c.overage) * c.overageRate)
}

/** "Free · 40 of 100 credits used this month". */
export function describeCredits(c: CreditStatus | null): string {
  if (!c) return 'Credits unavailable'
  const used = Math.round(c.used).toLocaleString()
  const total = Math.round(c.included).toLocaleString()
  return `${c.planName} · ${used} of ${total} credits used`
}
