# Verafo dashboard — deploy & wire-up

The dashboard (`verafo.vercel.app`, Vercel project **verafo**) and the Shopify
app (`get-verafo.vercel.app`) are separate deployments that share **one
Supabase project**.

---

## 1. Vercel env vars — the `verafo` project

Vercel → project **verafo** → Settings → Environment Variables → Production:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://gvjbolyoeisyjsphnwze.supabase.co` (the shared project) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the **publishable / anon** key from Supabase → Settings → API |

The admin ("network view") role is **not** an env var: it is read from the
`verafo_admins` table through `verafo_is_admin()`, so the UI and RLS can never
disagree and team emails are not shipped in the JS bundle. Add or remove admins
in SQL (see step 3), not in Vercel.

> If an old `VITE_ADMIN_EMAILS` variable is still set on Vercel, delete it — the
> app no longer reads it, and leaving it around invites the old drift between
> the bundle and the database.

Do **not** set `VITE_DEMO_ADMIN` in production (that makes every signed-in user an admin).

Then **Deployments → Redeploy** (from the latest commit).

Result: `verafo.vercel.app` now shows the **login screen**. A signed-in email in
`verafo_admins` sees the whole network; anyone else is a merchant and, on
first login, gets a one-step "create your store" screen, then sees only their own
store's data.

## 2. The Shopify app

The Shopify app is linked to the Shopify app **Verafo** (client ID
`ec17a432659bf1af629483bf28a50a25`, organisation *Verafo*, 233391614) and is
served from **https://get-verafo.vercel.app** — that is the `application_url`
and the host in every `auth.redirect_urls` entry, and it must not be changed to
the dashboard's domain.

Vercel → project **verafo-shopify** → Settings → Environment Variables → set:

```
VERAFO_DASHBOARD_URL = https://www.verafo.com/dashboard
```

That is what the app's **Open Verafo dashboard** button opens. Merchants must
never be sent to `*.vercel.app`: the dashboard's real address is the custom
domain, where `/` is the static marketing page and the app itself lives at
`/dashboard` (per the comment in `public/home.html`).

> **Always use `www`.** `https://www.verafo.com/dashboard` works, but
> `https://verafo.com/dashboard` currently returns **404**: the apex domain is
> attached to the Vercel project with a redirect to `www` that is still
> **unverified**, so the redirect never fires and the apex serves only the
> marketing page. Fix the apex DNS record (or remove the redirect) before using
> a `verafo.com` link anywhere.

Redeploy `verafo-shopify` after setting the variable. The "Open Verafo
dashboard" button then opens the real app instead of the Vercel deployment.

Config is deployed from `apps/shopify/shopify.app.toml` with a service-account
token (`.shopifydev`, permission *App development*):

```bash
export SHOPIFY_SERVICE_ACCOUNT_TOKEN=atkn_...
cd apps/shopify
shopify app deploy --no-release --no-build --message "…"   # create a version
shopify app release --version <name>                        # ship it
```

`shopify.app.toml` is the deployed reality — it was re-linked from Shopify, not
hand-written. Run `shopify app config link` before editing it by hand, or a
deploy will happily overwrite live settings (scopes, URLs, webhooks) with
whatever the file says.

## 3. Lock down the database (RLS)

App-level scoping (step 1) is the UX; **RLS is the actual wall**. Until you run
this, any signed-in user could still query another store's orders directly.

Run in **Supabase → SQL Editor**, in this order:

1. Open `supabase/rls-production.sql`.
2. **Edit the `insert into verafo_admins` line** near the top with your real team
   emails — that table is now the single source of truth for the admin role
   (there is no `VITE_ADMIN_EMAILS` to keep in sync).
3. Run the whole file.

The Shopify app + edge functions use the **service-role key**, which bypasses
RLS, so this does not affect the Shopify integration. A rollback block is at the
bottom of the file.

### Verify after RLS
- Sign in as an **admin email** → Overview shows network numbers, "Stores" nav is
  visible, Buyer Lookup works.
- Sign in as a **non-admin email** with a store (`stores.owner_email` = that
  email) → Overview shows only that store; no "Stores" nav; `/stores` redirects
  home; Buyer Lookup still returns a risk verdict for any phone.
- Place a test order via the **Shopify app** → it still lands in the DB (service
  role) and the merchant sees it.
- As a merchant, use **New Order** (or **Import**) in the web app itself → the
  order saves *and* the buyer's risk score/verdict updates. This exercises the
  buyers-table RLS + SECURITY DEFINER trigger path directly — if it were
  wired wrong, orders would still save but scores would silently stop
  updating for anything logged outside the Shopify app.

## 4. Local development

`.env` in this folder:

```
VITE_SUPABASE_URL=https://gvjbolyoeisyjsphnwze.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# VITE_DEMO_ADMIN=1   # optional: treat every login as admin
```

`npm install && npm run dev`

The admin role still comes from `verafo_admins` (the same hosted database), so
your real team account is admin locally too — no extra env var.

## 5. Auth email (Resend)

Sign-up confirmations, password resets and email-change mails go out through
Resend from the shared Supabase project. Configure once in
**Supabase → Authentication**:

| Setting | Value |
|---|---|
| SMTP host / port | `smtp.resend.com` / `465` |
| SMTP user | `resend` |
| SMTP password | a Resend **API key** (`re_…`) — needs *Sending* permission |
| Sender email / name | `noreply@verafo.com` / `Verafo` |
| Confirm email | **ON** (auto-confirm **OFF**) |
| Password policy | min length `8`, **no** character-class requirements |

`verafo.com` must stay verified in Resend (Resend → Domains) — an unverified or
expired sender is the usual reason "no email arrived".

### Redirect URLs

The app builds every auth redirect from `window.location.origin` (see
`src/lib/ui/auth-redirect.ts`), so it works on localhost, on Vercel previews and
in production without a rebuild. **Every origin must be on the Supabase
allow-list** (Authentication → URL Configuration → Redirect URLs):

```
http://localhost:5173/**
http://127.0.0.1:5173/**
https://www.verafo.com/**
https://verafo.com/**
https://verafo.vercel.app/**
```

A URL that is not on the list silently falls back to the Site URL, which sends
reset links to production instead of the app you are testing.

### Flows

- **Sign-up** — `signUp` sends a confirmation mail and returns **no session**.
  The login screen says "check your email". Confirming lands on
  `/login#access_token=…&type=signup`, which the app resolves straight into the
  app (onboarding for a merchant with no store). Signing up again with an
  already-registered address is reported as such: Supabase deliberately returns
  a fake user with `identities: []` and sends nothing, so the app checks for
  that instead of promising an email that never arrives.
- **Deep links** — a signed-out visit to any page redirects to
  `/login?next=<path>` (in-app paths only, no open redirect) and sign-in returns
  you there.
- **Forgot password** — `resetPasswordForEmail(..., { redirectTo })` lands on
  `/reset-password`, which exchanges the recovery link for a session and shows
  the "set a new password" form. Expired links show a readable message on the
  login screen instead of a silent redirect (the error is captured at page load,
  before the router can strip it). The button respects Supabase's one-mail-per
  -minute limit with a countdown.
- **Resend confirmation** — offered on the login screen when Supabase answers
  `email_not_confirmed`.
- **Change password** — Settings → Security asks for the current password
  (re-authenticates) before setting a new one.

> Do **not** restore the old `auto_confirm_email` trigger on `auth.users`. It
> stamped `email_confirmed_at` on insert, which meant every new account was
> confirmed the moment it was created, skipped the Resend confirmation email
> entirely, and dropped brand-new users straight onto the dashboard.

Changes to templates and SMTP settings can take a few minutes to reach the auth
service; they then apply to every newly generated email.

## 6. Bulk import & Shopify history

Bulk Import has three purposes, in order of importance:

1. **Courier history — the main import.** A courier's own report (CSV or Excel)
   sets the delivery outcome of every dispatched order. Rows match to an order by
   `order_reference`, then `courier_tracking_number`, then phone; only final
   statuses are written (delivered → accepted, refused/RTO/returned → refused),
   while in-transit and "undelivered – attempted" rows are held back. The
   preview separates *will change* from *already matches*, so the button count
   never overstates the work. Matching runs against the store's most recent
   2,000 orders.
2. **Courier integration (coming soon).** A merchant can record which courier
   and which of its APIs they use. This is stored in `store_courier_settings`
   (`supabase/courier-settings.sql`) and is **non-secret by design** — a provider
   name, an API label and a docs link. Credentials must go in Supabase secrets
   when the direct pulls ship, never in that table.
3. **Order history CSV** — for platforms that are not Shopify. This one is
   expected to retire once `read_all_orders` lands.

**Import with AI.** Both importers can ask the `verafo-ai` edge function
(`action: "map_columns"`) to map unknown vendor columns onto the fields the
importer understands. The model receives only the header row and up to five
sample rows, and returns a `field → header` mapping; it never sees the data
being imported. Suggestions are validated against the real header list, so a
hallucinated column cannot silently shift values. If the function is
unavailable, the importer falls back to its built-in alias tables.

**CSV import** (`/import`) is idempotent: every row gets a stable `import_ref`and `orders (store_id, import_ref)` is unique, so re-uploading the same file
skips rows instead of duplicating them. The parser handles `;`/tab delimited
files, UTF-8 BOMs, `Rs. 2,499` and `1.199,00` prices, `DD/MM/YYYY` dates (read as
Pakistan time), and maps courier/Shopify status words (`Delivered`, `RTO`,
`Cancelled`, …) onto accepted/refused/pending. Unrecognised statuses are listed
in the UI rather than silently becoming pending. 20,000 rows per file, 200 rows
per network round-trip.

**Phone identity.** `canonical_phone()` in Postgres and `canonicalPhone()` in the
app reduce `0300…`, `+92300…`, `0092300…` and bare `3001234567` to one
`+92…` number. Triggers on `orders` and `buyers` enforce it for every writer, so
the same person is never split across buyer rows. Existing split identities were
merged by `supabase/import-hardening.sql`.

**Shopify history.** The Shopify app has an *Import history* page that reads
orders from the Admin API and feeds the same ingest path as the webhooks. Each
browser request advances one page (100 orders, batched writes) and the cursor is
stored in `shopify_sync_runs`, so it resumes after a timeout, deploy or closed
tab.

How that page behaves:

- **Resumable, idempotent.** Orders upsert on `shopify_order_id`; re-running an
  import never duplicates. A page that hits Shopify's cost-based throttling is
  retried with backoff (4 attempts) instead of failing the whole run.
- **Never overwrites a decision.** `planOutcomeWrite()` only fills a missing or
  still-`pending` outcome; an order a merchant already marked accepted/refused
  is left alone when history is replayed.
- **Honest about the 60-day wall.** Without `read_all_orders` the range picker
  says so, and choosing *Everything* is refused rather than silently importing
  60 days and looking complete.
- **Protected customer data is checked implicitly.** Orders with no phone number
  are counted and surfaced in a banner, which is what a missing PII approval
  looks like from the outside.
- **Recoverable.** A failed run offers *Start over*, which abandons the stuck
  cursor and starts a clean one.

Shopify limits `read_orders` to **orders created in the last 60 days**. Older
history needs `read_all_orders`, which is granted per app:

1. Partner/organisation apps: Dev Dashboard → App → **Settings → Access
   requests → Read all orders → Request access** and describe the use case.
   Apps created under a merchant organisation for their own stores are exempt.
2. After approval, add `read_all_orders` next to `read_orders` in
   `apps/shopify/shopify.app.toml`, deploy a new app version, and release it.
   The import page then enables *Everything* with no code change — it already
   asks for the full range and the scope only widens what Shopify returns.
3. Each merchant approves the new scope the next time they open the app (the
   `app/scopes_update` webhook records the grant).
4. **Protected customer data** (buyer phone/address) is a separate review and is
   **already approved** for this app. Before that approval Shopify returned those
   fields as `null`, which is why orders would import with no buyer.

> Current status: `read_all_orders` **requested, awaiting Shopify review**.
> Attempting a deploy with it declared returns `app_access` on
> `scopes: read_all_orders` — that is the gate, not a config mistake. Everything
> else is in place, so the release is a one-line change once it lands.

Do **not** declare `read_all_orders` before it is approved: Shopify rejects the
app version with an `app_access` error on `scopes`.

### Outcome webhooks (decision pending)

`orders/cancelled` and `orders/fulfilled` handlers exist in
`apps/shopify/app/routes/`, but **neither topic is subscribed** — not in
`shopify.app.toml`, and the app never calls `registerWebhooks`. Until they are
subscribed, a cancellation or fulfilment in Shopify does not move the order to
refused/accepted; outcomes come from the dashboard, a CSV import, or the
historical backfill. If you subscribe them, remember that in Pakistani COD a
Shopify *fulfilled* order usually means *shipped*, not *delivered*, so treating
fulfilment as "accepted" would inflate acceptance rates.


### Access request text (paste into the Dev Dashboard)

> Verafo scores cash-on-delivery buyers for Pakistani merchants by looking at
> their order history across connected stores. To build that history for a newly
> installed store we need to score its past orders, which means reading orders
> older than 60 days. We use the data only for refusal-risk scoring shown in the
> app; it is not sold or shared, and historical orders are re-scored from the
> same rules as live webhooks. `read_orders` covers the last 60 days, so
> `read_all_orders` is required to import the rest of the merchant's own history.

**Protected customer data** is a separate request on the same page
(*Access requests → Protected customer data → Manage*): select the order and
customer fields the app uses — customer phone, name, email, shipping address —
and the purpose "analytics / risk scoring". Until it is approved, Shopify
returns those fields as `null` for non-development stores, so no order can be
anchored to a buyer and the backfill will write nothing.

A service-account token (`atkn_…`, in `.shopifydev`) can run `shopify app deploy`
and `shopify app release`, but it **cannot** file these requests or install the
app — those are manual Dev Dashboard reviews. Fill `client_id` in
`apps/shopify/shopify.app.toml` (currently empty) before deploying; without it
the CLI cannot link the app.



### Bot protection (not enabled)

Public sign-up currently has no CAPTCHA — `security_captcha_enabled` is false
and the project has no hCaptcha/Turnstile keys. Email confirmation plus
Supabase's per-address rate limits are the only brake. Before advertising the
sign-up page widely, enable Captcha in Supabase (Authentication → Attack
Protection) and pass `options.captchaToken` from the sign-up form.

