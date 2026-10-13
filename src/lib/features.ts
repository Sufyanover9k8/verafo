/* ============================================================
   features.ts — the switchboard for pages that are built but not
   released yet.

   ONE constant, read by three places, so a page can never be
   half-hidden:
     · src/components/layout/nav.ts  → the sidebar row AND the
       command-palette entry (the palette is built from NAV_SECTIONS)
     · src/App.tsx                   → the route itself

   Flip a value to true to bring that page back. While a flag is
   false its route does not exist, so a direct URL falls through to
   the catch-all and redirects to the dashboard.
   ============================================================ */

export const FEATURES = {
  /** Decide queue — needs the order_decisions table. */
  decide: false,
  /** Historical scan. */
  scan: false,
  /** What-if rule simulator. */
  simulate: false,
}
