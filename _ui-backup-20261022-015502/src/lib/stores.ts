/* ============================================================
   lib/stores.ts — linking a merchant to a store.

   The Shopify app creates its Verafo store row with only a name and a
   shopify_domain, leaving `owner_email` NULL. Store visibility is
   `lower(coalesce(owner_email, '')) = <your email>`, so orders that flow into
   such a row are invisible to the merchant who owns the shop, and adding the
   store by hand collides with the unique index on `stores.shopify_domain`
   instead of linking the two.

   `claimShopifyStore` closes that gap: it links the caller to an existing
   OWNERLESS store by domain. It never takes over a store that already has an
   owner.
   ============================================================ */

import { supabase } from './supabase'

export type ClaimResult =
  | { ok: true; storeId: string; storeName: string | null; alreadyOwned: boolean }
  | { ok: false; reason: ClaimFailure; message: string }

export type ClaimFailure =
  | 'unauthenticated'
  | 'no_domain'
  | 'not_found'
  | 'already_owned_by_another'
  | 'no_orders'
  | 'not_claimable'
  | 'needs_verification'
  | 'not_yours'
  | 'unavailable'

interface ClaimRow {
  ok?: boolean
  reason?: string
  store_id?: string
  store_name?: string | null
  already_owned?: boolean
}

/**
 * The merchant-facing sentence for each outcome. Kept here so both entry
 * points (Add e-brand and Onboarding) say the same thing.
 */
const MESSAGES: Record<ClaimFailure, string> = {
  unauthenticated: 'Please sign in again, then retry.',
  no_domain: 'Enter your Shopify domain, e.g. your-store.myshopify.com.',
  // Not an error: this domain has never been connected, so the caller should
  // simply create the store as usual.
  not_found: 'Not connected yet.',
  already_owned_by_another:
    'This Shopify store is already linked to another Verafo account. Contact support to move it.',
  no_orders:
    'That store has not received an order yet, so there is nothing to connect. It will appear here after its first order.',
  not_claimable: 'That domain cannot be connected.',
  /*
   * The two refusals that matter. A store with no recorded shop email cannot be
   * proven to be the caller's, and one that belongs to another email must not be
   * taken — "unowned" is not "yours".
   */
  needs_verification:
    'We cannot confirm that store belongs to you yet. Open the Verafo app inside Shopify admin and press Connect there.',
  not_yours: 'That Shopify store belongs to a different account.',
  unavailable: 'Could not check that Shopify domain just now. Please try again.',
}

export interface ClaimableStore {
  id: string
  name: string
  domain: string
  orders: number
  lastOrderAt: string | null
}

/**
 * Shopify stores that are sending orders but belong to nobody yet.
 *
 * The client cannot find these on its own: `stores` is scoped to
 * `owner_email = <you>`, so an ownerless row is invisible to every signed-in
 * user. `verafo_claimable_stores()` is SECURITY DEFINER and returns only the
 * unowned ones, which is exactly what the claim card offers to connect.
 *
 * Returns an empty list when the migration has not been applied, so the card
 * simply does not render.
 */
export async function listClaimableStores(): Promise<ClaimableStore[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('verafo_claimable_stores')
  if (error) return []
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    domain: String(r.shopify_domain ?? ''),
    orders: Number(r.orders ?? 0),
    lastOrderAt: (r.last_order_at as string | null) ?? null,
  }))
}

/**
 * Link the signed-in merchant to the store the Shopify app created for
 * `domain`, if it exists and has no owner yet.
 *
 * Returns `not_found` when nothing matches, which is the normal case for a
 * fresh store — the caller goes on to create one.
 */
export async function claimShopifyStore(domain: string): Promise<ClaimResult> {
  const clean = domain.trim().toLowerCase()
  if (!clean) return { ok: false, reason: 'no_domain', message: MESSAGES.no_domain }
  if (!supabase) return { ok: false, reason: 'unavailable', message: MESSAGES.unavailable }

  const { data, error } = await supabase.rpc('verafo_claim_store', { p_domain: clean })

  if (error) {
    /*
     * 42883 = function does not exist, i.e. supabase/shopify-store-claim.sql has
     * not been applied yet. Fall through to normal creation rather than blocking
     * the merchant behind a migration they may not control.
     */
    if (error.code === '42883' || error.message.includes('does not exist')) {
      return { ok: false, reason: 'not_found', message: MESSAGES.not_found }
    }
    return { ok: false, reason: 'unavailable', message: MESSAGES.unavailable }
  }

  const row = (data ?? {}) as ClaimRow
  if (row.ok) {
    return {
      ok: true,
      storeId: String(row.store_id ?? ''),
      storeName: row.store_name ?? null,
      alreadyOwned: Boolean(row.already_owned),
    }
  }

  const reason = (row.reason ?? 'unavailable') as ClaimFailure
  return { ok: false, reason, message: MESSAGES[reason] ?? MESSAGES.unavailable }
}
