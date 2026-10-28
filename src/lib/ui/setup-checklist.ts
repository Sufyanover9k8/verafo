/* ============================================================
   ui/setup-checklist.ts — how the "Finish setting up" card behaves.

   Hiding it used to be permanent on that device, which meant the one block
   written to get a new merchant through setup could vanish while setup was
   still unfinished — and nothing else on the dashboard says "you have not
   started yet".

   So Hide minimises instead of deleting:

     full    the card with the three steps and their buttons
     compact one row: progress, the next step, and a way back to the card
     hidden  nothing — only once every step is done

   A collapse also expires. After REMIND_AFTER_MS the full card comes back on
   its own, so a merchant who clicked Hide a month ago and still has not
   imported a single order is told again.
   ============================================================ */

/** Where the merchant's hide choice is remembered (device-local, see prefs.ts). */
export const SETUP_CHECKLIST_KEY = 'dashboard.checklistHidden'

/** How long a collapsed reminder stays quiet before re-expanding. */
export const REMIND_AFTER_MS = 7 * 24 * 60 * 60 * 1000

export type SetupCardMode = 'full' | 'compact' | 'hidden'

/**
 * The stored value is a millisecond timestamp of when the card was collapsed.
 * Anything else — the legacy `'1'` flag, junk, a clock that moved backwards —
 * reads as "not collapsed", because showing the card is always the safe side.
 */
export function parseCollapsedAt(raw: string | null, now = Date.now()): number | null {
  if (!raw) return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  // A real millisecond stamp is ~1.7e12 today. The legacy permanent flag ('1')
  // and any small number are not timestamps, so they land here.
  if (value < 1_000_000_000_000) return null
  // A stamp from the future is a clock change, not a real collapse: ignore it
  // rather than pinning the reminder away until the date arrives.
  if (value > now) return null
  return value
}

export function setupCardMode(args: {
  /** Every setup step is already satisfied by the merchant's data. */
  allDone: boolean
  /** When the merchant hid the card, or null if they never did. */
  collapsedAt: number | null
  /** Injectable for tests; defaults to the wall clock. */
  now?: number
}): SetupCardMode {
  const { allDone, collapsedAt } = args
  const now = args.now ?? Date.now()
  // Finished merchants are never nagged, whatever they clicked before.
  if (allDone) return 'hidden'
  if (collapsedAt == null) return 'full'
  return now - collapsedAt >= REMIND_AFTER_MS ? 'full' : 'compact'
}
