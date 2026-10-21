/* ============================================================
   lib/ui/fingerprint.ts — does this buyer have an AI fingerprint?

   The Buyer Lookup badge needs a yes/no. It cannot read the badge from
   `buyer_network_lookup` alone for two reasons:

     · that RPC deliberately returns no vector, and
     · its new `has_fingerprint` column only exists once
       supabase/lookup-fingerprint-flag.sql has been applied. Until then the
       badge could not be truthful no matter what the front-end did.

   So ask the `buyers` table directly for the ONE column that answers the
   question. RLS decides what is visible, which makes the answer correct for
   whoever is signed in:

     · a merchant sees the buyer if they have an order in one of their stores
       (policy "buyers read own"), so the check is accurate for their buyers;
     · a buyer who only ever ordered elsewhere is hidden, and the honest
       answer there is "no fingerprint" — we cannot claim to know.

   The vector itself is never selected.
   ============================================================ */

import { supabase } from '../supabase'
import { formatPhonePK } from './phone'

/** The spellings a stored phone might use, most canonical first. */
function phoneSpellings(raw: string): string[] {
  const pk = formatPhonePK(raw)
  if (!pk) return [raw]
  // e164 is "+923001234567"; the others are how the app and its imports store it.
  const digits = pk.e164.replace('+', '')
  const national10 = digits.slice(-10)
  return [...new Set([pk.e164, `0${national10}`, national10, digits])]
}

/**
 * TRUE when a stored embedding exists for this buyer.
 *
 * Returns null when the answer cannot be established (not signed in, or RLS
 * hides the row), so callers can fall back to whatever the server told them
 * rather than asserting something they do not know.
 */
export async function hasFingerprint(phone: string): Promise<boolean | null> {
  if (!supabase || !phone) return null
  const candidates = phoneSpellings(phone)
  const { data, error } = await supabase
    .from('buyers')
    .select('phone, embedding')
    .in('phone', candidates)
    .limit(1)
  if (error) return null
  const row = (data ?? [])[0] as { embedding?: unknown } | undefined
  if (!row) return null
  return row.embedding != null
}
