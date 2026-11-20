import { supabase } from './supabase'

/**
 * Plan allowances, as the merchant sees them.
 *
 * Buyer checks and AI calls are two separate pools:
 *
 *   - A check is one credit. Free packs 100 a month and stops at zero.
 *     Standard 1,500 a month, then PKR 2 a check. Founder One has no check
 *     limit at all.
 *   - A call is two credits whatever its length. Free includes ten calls in
 *     total, never per month. Standard 100 a month, then PKR 40 a call.
 *     Founder One 300 a month, then PKR 30 a call.
 *
 * Two credits a call is what lets a per-call price divide into whole credits:
 * PKR 40 = 20 credits-worth, PKR 30 = 15.
 */
export interface CreditStatus {
  planCode: string
  planName: string
  /** Check credits the plan packages each month. */
  included: number
  /** Check credits used this cycle. */
  used: number
  /** Packaged check credits left; zero once the plan is into overage. */
  remaining: number
  /** Check credits above the package, billed at `overageRate`. */
  overage: number
  overageRate: number
  /** Calls the plan includes. */
  includedCalls: number
  /** Calls used this cycle, or ever, when the allowance is one-time. */
  usedCalls: number
  /** Included calls left. */
  remainingCalls: number
  /** Calls above the package, billed at `overageRatePerCall`. */
  overageCalls: number
  overageRatePerCall: number
  /** PKR owed for the calls above the package. */
  overageCallPkr: number
  /** Free's ten calls never come back. */
  callsOneTime: boolean
  /** Paid plans may overspend their package; the free plan may not. */
  allowOverage: boolean
  /** Founder One has no check limit: counts are informational only. */
  unlimited: boolean
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
  includedCalls: 10,
  usedCalls: 0,
  remainingCalls: 10,
  overageCalls: 0,
  overageRatePerCall: 0,
  overageCallPkr: 0,
  callsOneTime: true,
  allowOverage: false,
  unlimited: false,
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
  included_calls?: number | string | null
  used_calls?: number | string | null
  remaining_calls?: number | string | null
  overage_calls?: number | string | null
  overage_pkr_per_call?: number | string | null
  overage_call_pkr?: number | string | null
  calls_one_time?: boolean | null
  unlimited_checks?: boolean | null
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
    includedCalls: Number(row.included_calls ?? 0),
    usedCalls: Number(row.used_calls ?? 0),
    remainingCalls: Number(row.remaining_calls ?? 0),
    overageCalls: Number(row.overage_calls ?? 0),
    overageRatePerCall: Number(row.overage_pkr_per_call ?? 0),
    overageCallPkr: Number(row.overage_call_pkr ?? 0),
    callsOneTime: Boolean(row.calls_one_time),
    allowOverage: Boolean(row.allow_overage),
    unlimited: Boolean(row.unlimited_checks),
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
      includedCalls: acc.includedCalls + s.includedCalls,
      usedCalls: acc.usedCalls + s.usedCalls,
      remainingCalls: acc.remainingCalls + s.remainingCalls,
      overageCalls: acc.overageCalls + s.overageCalls,
      overageCallPkr: acc.overageCallPkr + s.overageCallPkr,
      pricePkr: acc.pricePkr + s.pricePkr,
      allowOverage: acc.allowOverage || s.allowOverage,
      unlimited: acc.unlimited && s.unlimited,
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
      includedCalls: 0,
      usedCalls: 0,
      remainingCalls: 0,
      overageCalls: 0,
      overageRate: live[0].overageRate,
      overageRatePerCall: live[0].overageRatePerCall,
      overageCallPkr: 0,
      pricePkr: 0,
      unlimited: true,
    },
  )
}

/** May this store run another buyer check? Free stops at zero; paid does not. */
export function canSpend(c: CreditStatus | null): boolean {
  if (!c) return true
  if (c.unlimited) return true
  return c.allowOverage || c.remaining >= 1
}

/** May this store place another call? Its own allowance decides. */
export function canCall(c: CreditStatus | null): boolean {
  if (!c) return true
  if (c.remainingCalls >= 1) return true
  return c.allowOverage && c.overageRatePerCall > 0
}

/** PKR owed for the check credits above the package. */
export function overagePkr(c: CreditStatus | null): number {
  if (!c) return 0
  return Math.round(Math.max(0, c.overage) * c.overageRate)
}

/** PKR owed for the calls above the package. */
export function overageCallPkr(c: CreditStatus | null): number {
  if (!c) return 0
  return Math.round(Math.max(0, c.overageCalls) * c.overageRatePerCall)
}

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`

/** "Free · 40 of 100 credits used" — Founder One says unlimited. */
export function describeCredits(c: CreditStatus | null): string {
  if (!c) return 'Credits unavailable'
  const used = Math.round(c.used).toLocaleString()
  if (c.unlimited) return `${c.planName} · ${used} checks used · unlimited`
  const total = Math.round(c.included).toLocaleString()
  return `${c.planName} · ${used} of ${total} credits used`
}

/** "Free · 3 of 10 calls used" — a one-time allowance says so. */
export function describeCalls(c: CreditStatus | null): string {
  if (!c) return 'Calls unavailable'
  const used = Math.round(c.usedCalls).toLocaleString()
  const total = Math.round(c.includedCalls).toLocaleString()
  const tail = c.callsOneTime ? ' free calls used' : ' calls used this month'
  return `${c.planName} · ${used} of ${total}${tail}`
}

/** "PKR 40 a call" / "PKR 2 a check" — the rate a plan bills past its package. */
export function callRateLabel(c: CreditStatus | null): string {
  if (!c || c.overageRatePerCall <= 0) return 'no extra calls'
  return `${pkr(c.overageRatePerCall)} a call`
}

/** What a check costs past the package: "PKR 2 a check", or "unlimited". */
export function checkRateLabel(c: CreditStatus | null): string {
  if (!c) return ''
  if (c.unlimited) return 'unlimited checks'
  if (c.overageRate <= 0) return 'stops at zero'
  return `${pkr(c.overageRate)} a check`
}
