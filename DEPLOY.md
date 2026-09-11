# Verafo dashboard — deploy & wire-up

The dashboard (`verafo.vercel.app`, Vercel project **verafo**) and the Shopify
app (`verafo-shopify.vercel.app`) are separate deployments that share **one
Supabase project**.

---

## 1. Vercel env vars — the `verafo` project

Vercel → project **verafo** → Settings → Environment Variables → Production:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://gvjbolyoeisyjsphnwze.supabase.co` (the shared project) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | the **publishable / anon** key from Supabase → Settings → API |
| `VITE_ADMIN_EMAILS` | comma-separated Verafo team emails, e.g. `you@verafo.com,cofounder@verafo.com` |

Do **not** set `VITE_DEMO_ADMIN` in production (that makes every signed-in user an admin).

Then **Deployments → Redeploy** (from the latest commit).

Result: `verafo.vercel.app` now shows the **login screen**. A signed-in email on
`VITE_ADMIN_EMAILS` sees the whole network; anyone else is a merchant and, on
first login, gets a one-step "create your store" screen, then sees only their own
store's data.

## 2. Point the Shopify app at the real dashboard

Vercel → project **verafo-shopify** → Settings → Environment Variables → set:

```
VERAFO_DASHBOARD_URL = https://verafo.vercel.app
```

Redeploy `verafo-shopify`. The "Open Verafo dashboard" link in the Shopify app
now opens the real app instead of `localhost:5173`.

## 3. Lock down the database (RLS)

App-level scoping (step 1) is the UX; **RLS is the actual wall**. Until you run
this, any signed-in user could still query another store's orders directly.

Run in **Supabase → SQL Editor**, in this order:

1. Open `supabase/rls-production.sql`.
2. **Edit the `insert into verafo_admins` line** near the top with your real team
   emails (must match `VITE_ADMIN_EMAILS`).
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

## 4. Local development

`.env` in this folder:

```
VITE_SUPABASE_URL=https://gvjbolyoeisyjsphnwze.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_ADMIN_EMAILS=you@verafo.com
# VITE_DEMO_ADMIN=1   # optional: treat every login as admin, no allowlist
```

`npm install && npm run dev`
