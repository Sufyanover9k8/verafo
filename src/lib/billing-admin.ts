/* billing-admin.ts — the admin Billing tab's data layer.
 *
 * Everything here is authorised server-side: `admin_billing_overview()` and the
 * four `admin_*` RPCs raise `not allowed` unless `verafo_is_admin()` passes, so
 * the page never has to be trusted. The types mirror the SQL return columns.
 */
import { supabase } from './supabase'

export interface BillingRow {
  store_id: string
  store_name: string
  shopify_domain: string | null
  owner_email: string | null
  plan_code: string
  plan_name: string
  plan_status: string
  suspended: boolean
  price_pkr: number
  included_credits: number
  included_override: number
  used_credits: number
  remaining_credits: number
  overage_credits: number
  overage_pkr_per_credit: number
  unlimited_checks: boolean
  included_calls: number
  used_calls: number
  remaining_calls: number
  overage_calls: number
  overage_pkr_per_call: number
  owed_pkr: number
  cycle_end: string | null
  billed_credits: number
  billed_calls: number
  subscription_id: string | null
  current_period_end: string | null
}

export interface PlanOption {
  code: string
  name: string
  price_pkr: number
  included_credits: number
  overage_pkr_per_credit: number
  included_calls: number
  overage_pkr_per_call: number
  unlimited_checks: boolean
  calls_one_time: boolean
  allow_overage: boolean
}

function fail(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message ?? fallback)
}

export async function readBillingRows(): Promise<BillingRow[]> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.rpc('admin_billing_overview')
  if (error) fail(error, 'Could not read billing')
  return ((data ?? []) as BillingRow[]).map((row) => ({
    ...row,
    price_pkr: Number(row.price_pkr ?? 0),
    included_credits: Number(row.included_credits ?? 0),
    included_override: Number(row.included_override ?? 0),
    used_credits: Number(row.used_credits ?? 0),
    remaining_credits: Number(row.remaining_credits ?? 0),
    overage_credits: Number(row.overage_credits ?? 0),
    overage_pkr_per_credit: Number(row.overage_pkr_per_credit ?? 0),
    included_calls: Number(row.included_calls ?? 0),
    used_calls: Number(row.used_calls ?? 0),
    remaining_calls: Number(row.remaining_calls ?? 0),
    overage_calls: Number(row.overage_calls ?? 0),
    overage_pkr_per_call: Number(row.overage_pkr_per_call ?? 0),
    owed_pkr: Number(row.owed_pkr ?? 0),
    billed_credits: Number(row.billed_credits ?? 0),
    billed_calls: Number(row.billed_calls ?? 0),
  }))
}

export async function readPlanOptions(): Promise<PlanOption[]> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('plans')
    .select(
      'code, name, price_pkr, included_credits, overage_pkr_per_credit, included_calls, overage_pkr_per_call, unlimited_checks, calls_one_time, allow_overage, sort_order',
    )
    .order('sort_order')
  if (error) fail(error, 'Could not read plans')
  return ((data ?? []) as unknown as PlanOption[]).map((p) => ({
    ...p,
    price_pkr: Number(p.price_pkr ?? 0),
    included_credits: Number(p.included_credits ?? 0),
    overage_pkr_per_credit: Number(p.overage_pkr_per_credit ?? 0),
    included_calls: Number(p.included_calls ?? 0),
    overage_pkr_per_call: Number(p.overage_pkr_per_call ?? 0),
  }))
}

export async function changePlan(storeId: string, code: string): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('admin_set_plan', { p_store: storeId, p_plan: code })
  if (error) fail(error, 'Could not change the plan')
}

export async function setPlanState(storeId: string, status: string, suspended: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('admin_set_plan_state', {
    p_store: storeId,
    p_status: status,
    p_suspended: suspended,
  })
  if (error) fail(error, 'Could not change the plan state')
}

export async function setPackage(storeId: string, included: number): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('admin_set_package', {
    p_store: storeId,
    p_included: Math.max(0, Math.round(included)),
  })
  if (error) fail(error, 'Could not set the package')
}

/** Positive numbers add allowance, negative numbers take it away. */
export async function grantAllowance(
  storeId: string,
  checks: number,
  calls: number,
  note: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase.rpc('admin_grant_allowance', {
    p_store: storeId,
    p_checks: Math.round(checks),
    p_calls: Math.round(calls),
    p_note: note.trim() || null,
  })
  if (error) fail(error, 'Could not change the allowance')
}
