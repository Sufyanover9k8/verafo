# Verafo MVP

Prove that a shared, phone-keyed buyer profile can predict COD refusal risk across stores —
with nothing more than order logs and delivery outcomes. Three screens, one background job,
dark UI, [Ionicons](https://ionic.io/ionicons) throughout.

> "Type in a phone number, and before you ship, Verafo tells you how likely this buyer is
> to accept the parcel — based on how they've behaved across every connected store, not just yours."

## Stack

- **Supabase** — Postgres + pgvector + auto REST API + RLS. Schema, score logic and
  nearest-neighbour search all live in SQL (`supabase/schema.sql`).
- **OpenAI API** — one server-side Edge Function (`supabase/functions/verafo-ai`) for
  buyer embeddings and plain-English explanations. Never exposed in the browser bundle.
- **React + Vite + TypeScript** — the seller-facing app.

## Screens

1. **New Order** (`/`) — log an order; the buyer's risk badge appears live as you type the
   phone number, before the order is saved.
2. **Mark Outcome** (`/outcomes`) — pending orders with Accepted / Refused buttons. Every
   outcome re-scores the buyer immediately (database trigger).
3. **Buyer Lookup** (`/lookup`) — full cross-store profile: badge, score bar, totals,
   distinct stores, order timeline, similar buyers (embedding neighbours), and an optional
   AI one-line explanation.

## How the risk score works (v0 — pure SQL, no AI needed)

- No resolved orders → neutral `0.50`.
- Otherwise the refusal rate, pulled toward `0.50` until 3+ resolved orders exist.
- Boosters: never-seen-before address `+0.05`, phone first seen today `+0.05`,
  5+ accepted across 2+ stores `−0.20`. Clamped to `[0, 1]`.

Thresholds used by the UI: `< 0.45` green (low risk), `0.45–0.65` amber (caution),
`> 0.65` red (high risk).

## Setup

### 1. Database

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run `supabase/schema.sql`.
3. (Optional but recommended for the demo) run `supabase/seed.sql` — 3 stores and 5 buyers
   with realistic cross-store history, ready to explore.

### 2. Frontend

```bash
npm install
copy .env.example .env   # fill in VITE_SUPABASE_URL and your anon/publishable key
npm run dev              # http://localhost:5173
```

Without env vars the app shows a setup hint instead of erroring.

### 3. AI layer (optional — embeddings + explanations)

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy verafo-ai --no-verify-jwt
supabase secrets set OPENAI_API_KEY=sk-...
```

Then in the Buyer Lookup screen: **Refresh fingerprint** embeds the buyer's behaviour
(`text-embedding-3-small`, 1536-dim vector stored in `buyers.embedding`) and **Explain this
buyer** generates a one-line summary. Everything degrades gracefully if the function is absent.

## Security notes

- The OpenAI key and Supabase service key live **only** in the Edge Function env.
- The browser uses only the anon key.
- `schema.sql` enables RLS on all tables with permissive demo policies for `anon`.
  Replace them with authenticated-role policies (one per store owner) before anything real.

## Project layout

```
supabase/
  schema.sql                 tables, triggers, recompute_buyer(), find_similar_buyers(), RLS
  seed.sql                   demo data: 3 stores, 5 buyers
  config.toml                edge function config
  functions/verafo-ai/       OpenAI embeddings + explanations (Deno)
src/
  lib/                       supabase client, score rules, formatting, toast
  components/                badge, scorebar, icons, states, layout pieces
  pages/                     NewOrder · Outcomes · Lookup
```
