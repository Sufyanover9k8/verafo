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
  unavailable: 'Could not check that Shopify domain just now. Please try again.',
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
