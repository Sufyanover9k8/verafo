/* ============================================================
   lib/ui/buyer-key.ts — one buyer, one row.

   THE RECURRING ROOT CAUSE. `buyers.phone` is the identity key and every other
   table points at it, but the app has always stored whatever spelling arrived:

     03445974567   as Shopify exports it
     +923445974567 as New Order stored it
     923445974567  when an export drops the leading zero

   The same customer therefore became two buyer rows with two independent
   histories and two risk scores. Both halves looked plausible, so nothing
   surfaced as an error — but a buyer who refused twice could still read SAFE
   because each refusal sat in a different row.

   THE FIX, and why it is not simply "always write +92": a book that is already
   spelled 0... everywhere would gain a duplicate row for every new order if the
   writer standardised on a different shape. So the write path asks first:

     · if any spelling of this number already exists, REUSE its spelling, so the
       new order joins that buyer's existing history;
     · otherwise write the canonical +92 form, so new books are consistent.

   This is deliberately conservative: it never rewrites existing rows, it only
   stops creating new duplicates.
   ============================================================ */

import { supabase } from '../supabase'
import { formatPhonePK } from './phone'

/** '+923445974567' when the number can be trusted, else the digits we were given. */
export function canonicalPhone(raw: string | null | undefined): string {
  const pk = formatPhonePK(raw)
  if (pk) return pk.e164
  return String(raw ?? '').replace(/[^\d+]/g, '')
}

/** Every spelling a stored row might use for this number. */
export function phoneSpellings(raw: string | null | undefined): string[] {
  const pk = formatPhonePK(raw)
  if (!pk) {
    const only = canonicalPhone(raw)
    return only ? [only] : []
  }
  const digits = pk.e164.replace('+', '')       // 923445974567
  const national10 = digits.slice(-10)          // 3445974567
  return [
    ...new Set([
      pk.e164,        // +923445974567
      `0${national10}`, // 03445974567
      national10,     // 3445974567
      digits,         // 923445974567
    ]),
  ]
}

/**
 * The spelling this buyer should be written under.
 *
 * Returns the spelling already on file when the buyer exists, so a new order
 * joins the existing row instead of forking a second one. Falls back to the
 * canonical form for a genuinely new buyer.
 */
export async function resolveBuyerPhone(raw: string): Promise<string> {
  const fallback = canonicalPhone(raw)
  if (!supabase || !fallback) return fallback
  const candidates = phoneSpellings(raw)
  if (candidates.length === 0) return fallback
  try {
    const { data, error } = await supabase
      .from('buyers')
      .select('phone')
      .in('phone', candidates)
      .limit(1)
    if (error) return fallback
    const row = (data ?? [])[0] as { phone?: string } | undefined
    // Found on file: keep that exact string, or the FK and the score follow the
    // wrong row.
    return row?.phone ? String(row.phone) : fallback
  } catch {
    return fallback
  }
}
