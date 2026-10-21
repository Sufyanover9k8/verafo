/* ============================================================
   lib/ui/auto-embed.ts — give every buyer a fingerprint, without being asked.

   Fingerprints used to be built only when someone pressed a button, so a buyer
   added today had none until a merchant went looking — and every such buyer
   read "no fingerprint yet". This drives the backfill from the app itself:

     · once per session window, so it cannot spam the function,
     · capped server-side per call, so it makes progress and stops,
     · silent on failure — it is background housekeeping, never an error the
       merchant has to act on.

   `embedBuyer(phone)` is the targeted version for the buyer in front of them,
   so looking one up turns its badge green immediately.
   ============================================================ */

import { aiJson } from '../ai'
import { functionsBaseUrl } from '../supabase'

/** How often a session may run the sweep. */
const SWEEP_EVERY_MS = 10 * 60 * 1000
const SWEEP_KEY = 'verafo.embedSweepAt'

/** Phones already attempted this session, so a page view never repeats work. */
const attempted = new Set<string>()

/**
 * Embed buyers who have no fingerprint yet. Returns how many were embedded.
 *
 * Safe to call from an effect: it no-ops when the sweep ran recently, when the
 * AI function is not deployed, or when offline.
 */
export async function sweepMissingFingerprints(): Promise<number> {
  if (!functionsBaseUrl()) return 0
  try {
    const last = Number(localStorage.getItem(SWEEP_KEY) ?? 0)
    // A clock that moved backwards must not lock the sweep out forever.
    if (Number.isFinite(last) && last > 0 && Date.now() - last < SWEEP_EVERY_MS) return 0
    localStorage.setItem(SWEEP_KEY, String(Date.now()))
  } catch {
    /* storage unavailable — carry on, the server cap protects us */
  }

  try {
    const json = await aiJson<{ embedded?: number }>('embed_pending', {})
    return Number(json.embedded ?? 0)
  } catch {
    return 0
  }
}

/**
 * Embed one buyer immediately — used when a merchant opens a buyer who has no
 * fingerprint, so the badge reflects the work rather than making them press a
 * button. Skips anyone already attempted this session.
 */
export async function embedBuyerNow(phone: string): Promise<boolean> {
  if (!phone || !functionsBaseUrl()) return false
  if (attempted.has(phone)) return false
  attempted.add(phone)
  try {
    await aiJson('embed', { phone })
    return true
  } catch {
    return false
  }
}
