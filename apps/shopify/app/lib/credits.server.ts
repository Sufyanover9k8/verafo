import { getSupabase } from "./supabase.server";

/**
 * The store's allowance, read from the same RPC the web dashboard and the
 * mobile app use (`public.store_credit_status`). The embedded app must never
 * keep its own copy of the rules: one credit a check, two a call.
 */
export interface StoreCredits {
  plan_name: string | null;
  included_credits: number | null;
  used_credits: number | null;
  remaining_credits: number | null;
  overage_credits: number | null;
  overage_pkr_per_credit: number | null;
  unlimited_checks: boolean | null;
  included_calls: number | null;
  used_calls: number | null;
  remaining_calls: number | null;
  overage_calls: number | null;
  overage_pkr_per_call: number | null;
  calls_one_time: boolean | null;
  cycle_end: string | null;
}

export async function readCredits(storeId: string | null | undefined): Promise<StoreCredits | null> {
  if (!storeId) return null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc("store_credit_status", { p_store: storeId });
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? null) as StoreCredits | null;
  } catch {
    // A billing read must never take the admin page down with it.
    return null;
  }
}

export function checksLabel(credits: StoreCredits | null): string {
  if (!credits) return "—";
  if (credits.unlimited_checks) return "Unlimited";
  const left = Number(credits.remaining_credits ?? 0);
  return `${Math.max(0, Math.round(left)).toLocaleString("en-PK")} left`;
}

export function callsLabel(credits: StoreCredits | null): string {
  if (!credits) return "—";
  const left = Math.max(0, Math.round(Number(credits.remaining_calls ?? 0)));
  const included = Math.round(Number(credits.included_calls ?? 0));
  return `${left} of ${included}${credits.calls_one_time ? " (one time)" : ""}`;
}
