# Verafo

Verafo is a standalone revenue-intelligence and COD risk product for Pakistani
merchants. It scores every cash-on-delivery buyer before a seller ships, using
order history across a network of connected stores.

This repository root **is** the Verafo product: a React + Vite single-page app
deployed to Vercel. `apps/shopify/` is a separate integration (an order source
and webhook host) and is **not** the product — nothing in `src/` imports it.

> "Type in a phone number, and before you ship, Verafo tells you how likely this buyer is
> to accept the parcel — based on how they've behaved across every connected store, not just yours."

## Stack

- **Supabase** — Postgres + pgvector + auto REST API + RLS. Schema, score logic and
  nearest-neighbour search live in SQL (`supabase/schema.sql`).
- **OpenAI API** — one server-side Edge Function (`supabase/functions/verafo-ai`) for
  buyer embeddings and plain-English explanations. Never exposed in the browser bundle.
- **React 19 + Vite + TypeScript** — the merchant-facing app.
- **Tailwind v4 + shadcn/ui** — styling, built on the Verafo design tokens in
  `src/styles/`. Light by default, dark mode supported.
- **recharts / three.js / Leaflet** — charts, the 3D buyer map, and city maps. All
  lazy-loaded; none of them is in the first-paint bundle.

## Screens

| Route | Screen |
|---|---|
| `/` | Dashboard — today's verdict, money at risk, orders needing a decision |
| `/orders` | Orders — every order with buyer risk, filters and outcomes |
| `/orders/pending` | Outcomes — mark accepted or refused |
| `/orders/new` | New Order — log an order and see the verdict live |
| `/lookup` | Buyer Lookup — full cross-store profile for a phone number |
| `/map` | RTO Insights — buyers across two dimensions, colour-coded by risk |
| `/chat` | Ask Verafo — questions answered against your own order data |
| `/import` | Bulk Import — load past orders from CSV |
| `/settings` | Settings — appearance, data and connection |
| `/stores` | Stores (admins) — every connected brand |

Sign-in, password reset and first-store onboarding are handled before the shell.

## How the risk score works (pure SQL, no AI needed)

- No resolved orders → not scored. The UI shows **UNKNOWN**, never "safe".
- Otherwise the refusal rate, pulled toward `0.50` until 3+ resolved orders exist.
- Boosters: never-seen-before address `+0.05`, phone first seen today `+0.05`,
  5+ accepted across 2+ stores `−0.20`. Clamped to `[0, 1]`.

Thresholds live in `src/lib/risk.ts`, the single source of truth:
`< 0.45` LOW RISK, `0.45–0.65` MEDIUM RISK, `> 0.65` HIGH RISK. A buyer with no
resolved orders is UNKNOWN. The verdict word is always shown alongside colour.

## Shared helpers (`src/lib/ui/`)

Display and analytics logic that is pure, tested, and has no database access:

| File | What it does |
|---|---|
| `phone.ts` | Pakistani phone parsing and `tel:` / WhatsApp links. Returns null rather than a broken link. |
| `csv.ts` | CSV with quoting, a UTF-8 BOM, and defence against spreadsheet formula injection. |
| `money.ts` | PKR formatting with thousands separators. |
| `analytics.ts` | City, product and weekday refusal rates, refusal-rate trends, money at risk, buyer segments. Will not publish a rate below a 10-order sample, and keeps unknown outcomes in their own bucket. |
| `prefs.ts` | Device-only display preferences; every read and write is guarded so private browsing cannot break a page. |
| `use-auto-refresh.ts` | Timer that pauses while the tab is hidden and never overlaps itself. |

## Setup

### 1. Database

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run, in this order:
   - `supabase/schema.sql`
   - `supabase/rls-production.sql` — **edit the admin email list at the top first**
   - `supabase/store-plans-migration.sql` (optional; only if you use the plan badge)
   - `supabase/shopify-migration.sql` (only if you use the Shopify integration)
3. Optional, for a demo: `supabase/seed.sql`.

### 2. Frontend

```bash
npm install
cp .env.example .env    # then fill in VITE_SUPABASE_URL and the publishable key
npm run dev
```

Other scripts: `npm run build`, `npm run preview`, `npm test`, `npm run lint`.

## Testing notes

- `npm test` runs the Vitest suite. `vitest.config.ts` uses a single forked process
  (`fileParallelism: false`) because the default worker-per-file pool times out on
  constrained machines, and these tests are pure functions.
- In restricted sandboxes `npm test`, `npm run dev` and `npm run build` can fail with
  `spawn EPERM` — esbuild's config service needs a named pipe. That is an environment
  limit, not a project defect. Run them outside the sandbox.

## Deployment

The dashboard is the Vercel project **verafo**, built from this folder. See
`DEPLOY.md` for the environment variables and the RLS step, and
`DEPLOY-PLAN-BADGE.md` if you are deploying the plan badge.
