# Verafo for Shopify

Offical Shopify Remix app that connects any Shopify store to Verafo's
cross-store risk network. Phone number is the anchor key: every store feeding
orders through the same phone instantly benefits from the network's refusal
history and Verafo's risk score.

## How it works

```
Shopify store ── OAuth install ──▶ Remix app (apps/shopify)
     │                                  │
     │ webhooks                         │ upsert buyer/order/outcome
     │ orders/create ───────────────► Supabase (service role)
     │ orders/cancelled ────────────► recompute_buyer trigger re-scores buyer
     │ orders/fulfilled ────────────► risk network across all connected stores
     │
     └─ embedded admin shows verdict per order (LOW/MED/HIGH + confidence)
```

- **Ingest:** `orders/create` webhook upserts the buyer and order (idempotent
  via `orders.shopify_order_id`) and creates a `pending` outcome.
- **Outcome signals:** `orders/cancelled` → `refused`, `orders/fulfilled` →
  `accepted`. The existing `recompute_buyer` Postgres trigger re-scores the
  buyer across the whole network.
- **Admin UI:** embedded app shows the risk verdict, confidence, order status,
  and distribution. A "Sync recent orders" button backfills up to 50 orders via
  the Admin GraphQL API (same ingest path as webhooks).

## One-time Supabase setup

1. Run `supabase/schema.sql` in the Supabase SQL editor (if not already).
2. (Optional) Run `supabase/seed.sql` for demo data from the main app.
3. Run `supabase/shopify-migration.sql` — adds `stores.shopify_domain`,
   `orders.shopify_order_id`, and the `upsert_store_for_shop()` helper.

## Shopify app setup

1. Create the app in the Shopify Partner dashboard
   (https://partners.shopify.com › Apps › Create app), choose "Build it with
   Remix" (or any — you re-link below).
2. Copy the app API key + secret into `.env` (see `.env.example`).
3. Required scopes: `read_orders, write_orders, read_customers`.

## Environment

Copy `.env.example` to `.env`:

| Variable                  | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `SHOPIFY_API_KEY`         | Shopify app API key                                |
| `SHOPIFY_API_SECRET`      | Shopify app secret (webhook HMAC verification)     |
| `SHOPIFY_APP_URL`         | Public HTTPS URL of this app                       |
| `SCOPES`                  | `read_orders,write_orders,read_customers`          |
| `SUPABASE_URL`            | Verafo Supabase project URL                        |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key (never expose to the browser)    |
| `DATABASE_URL`            | Optional — session storage. SQLite by default      |

## Local development

```bash
cd apps/shopify
npm install
npm run setup          # prisma generate + migrate deploy (creates dev.sqlite)
npm run dev            # shopify app dev — tunnels + registers webhooks + OAuth
```

`shopify app dev` handles the OAuth install into a development store and
registers the webhook subscriptions declared in `shopify.app.toml`.

## Deploy

```bash
cd apps/shopify
npm run deploy                       # shopify app deploy (to your partner org)
```

The app is a standard React Router (Remix) Node app — `npm run build && npm start`
runs the production server. Session storage is SQLite by default; point
`DATABASE_URL` at your hosted Postgres before multi-instance scaling
(`@shopify/shopify-app-session-storage-prisma`).

## Webhooks ↔ Verafo mapping

| Shopify topic        | Route                              | Verafo effect                       |
| -------------------- | ---------------------------------- | ----------------------------------- |
| `orders/create`      | `/webhooks/orders/create`          | upsert buyer + order, outcome `pending` |
| `orders/cancelled`   | `/webhooks/orders/cancelled`       | outcome `refused` (refusal_reason)  |
| `orders/fulfilled`   | `/webhooks/orders/fulfilled`       | outcome `accepted`                  |
| `app/uninstalled`    | `/webhooks/app/uninstalled`        | drop link, keep buyer history       |

Failed webhook handlers return HTTP 500 so Shopify retries.

## Testing

```bash
npm test          # unit tests for phone normalization, order mapping, verdict
npm run lint
npm run build
```

## Notes / limitations

- Orders **without a customer phone** cannot be anchored to a buyer and are
  skipped (they log as "skipped" in the ingest handler). Phone-less stores get
  INSUFFICIENT DATA by design.
- Buyer scores are shared *across* every connected store as soon as the
  buyer's phone appears. This is the network effect; refuse often enough at any
  store and your store sees the risk too.
- The uninstall webhook unlinks the store but keeps buyer history and scores,
  so re-installing immediately restores the network view.