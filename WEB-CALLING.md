# Calls on the web

The website now dials through the same Uplift stack the mobile app uses. Nothing
new runs on the server: `auto-verify`, `verify-status` and `call-queue` are
already deployed and are the only things this code talks to.

## What changed

| File | Change |
| --- | --- |
| `src/lib/calls.ts` *(new)* | Typed client for `auto-verify`, `verify-status`, `call-queue` — one call, one settings read/write, one queue read. |
| `src/components/app/call-button.tsx` *(new)* | `CallButton` + `useCallAction`. Starts a Uplift call, polls `verify-status` every 6 s for up to two minutes, toasts the verdict. The in-flight call lives at module scope, so the toast still arrives if the row re-renders or the card re-mounts while the phone is ringing. |
| `src/components/app/automate-calls.tsx` *(new)* | The "Automate calls" switch — same `store_call_settings.auto_call` the app flips. |
| `src/components/app/row-actions.tsx` | `Call` places a real Uplift call when it knows the order; it only opens the device dialer for a bare number. |
| `src/pages/Dashboard.tsx` | Passes `orderId` to the row actions so "Needs your attention" calls through Uplift. |
| `src/pages/Outcomes.tsx` | "Automate calls" sits next to Refresh, above the pending list. |
| `src/pages/Settings.tsx` | New **Calling** card: automate switch, risk threshold (35/50/65/80 %), monthly budget. |
| `src/pages/Decide.tsx` | Same wiring, for when `FEATURES.decide` is turned on (it is `false` today, so this page is not routed). |

Also included, from the earlier report: returning to the tab no longer refetches
(`use-auto-refresh.ts`), background refreshes no longer blank the page into
skeletons (`Dashboard.tsx`), and the duplicate `stores` / `/auth/v1/user`
requests are gone (`store.tsx`, `admin.ts`).

## Settings the server owns

`store_call_settings` still decides everything; the web only edits it.

- `auto_call` — the switch. The `call-queue` cron pulls pending orders with
  `risk_score >= risk_threshold` into `call_queue` and dials one at a time.
- `risk_threshold` — 0–1. The same line the app uses.
- `monthly_budget_pkr` — 12 PKR per minute of talk time; calls stop at zero.
- `apply_mode` — set in the app, not exposed here yet (`off` / `local` /
  `shopify`).

## Build and deploy

```powershell
npm ci
npm run build      # tsc -b && vite build
vercel --prod      # or drag dist/ wherever the site is served from
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` must be present at build
time — Vite inlines them.

## One thing to know before deploying this folder

The live site was last published with `vercel` from a local working copy
(`source=cli` in the Vercel API), and that copy is **ahead of GitHub `main`**: it
has the "Good morning, <name>" dashboard header and the Google sign-in button,
and neither exists on any pushed branch. This folder is `main` plus the changes
above, so deploying it would drop those. Compare against your local copy first,
or port these files into it.
