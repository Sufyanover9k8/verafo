# Deploy the plan badge

A step-by-step guide. You do not need to have seen this project before.
Follow the steps in order. Do not skip the backup.

---

## 1. What this change does

It saves which Shopify plan each shop is on (Free, Standard or Advanced).
It does this with a new webhook in the Shopify app.
The dashboard then shows the plan as a small teal pill.

It only **reads** the plan. It never creates, changes or cancels a subscription.

---

## 2. What you need before you start

### Accounts and access

| What | Why | How to check |
|---|---|---|
| Supabase account, with access to the **Verafo** project | To run the database migration | You can open the project at supabase.com and see **SQL Editor** in the left menu |
| Shopify Partner account, with access to the Verafo app | To deploy the webhook config | You can open the app in the Partner Dashboard |
| Vercel account, with access to the project **verafo** | To deploy the dashboard | You can open the project at vercel.com |
| Access to the server that hosts the **Shopify app** (Vercel project **verafo-shopify**) | The webhook code must be running there | You can open the project **verafo-shopify** at vercel.com |

### Tools

| Tool | Version | How to check it works |
|---|---|---|
| Node.js | 20.19 or newer | `node --version` |
| npm | comes with Node | `npm --version` |
| Shopify CLI | v3 or newer | `shopify version` |
| Vercel CLI | any recent version | `vercel --version` |

If `shopify version` says "command not found", install it with `npm install -g @shopify/cli`.
If `vercel --version` says "command not found", install it with `npm install -g vercel`.

Then log in to both:

```
shopify auth login
vercel login
```

### Secrets — where they live, not what they are

Never copy a secret into this file. Each one lives in a settings screen:

| Setting name | Where it lives |
|---|---|
| `SUPABASE_URL` | Vercel → project **verafo-shopify** → Settings → Environment Variables |
| `SUPABASE_SERVICE_ROLE_KEY` | Same screen. Also in Supabase → Settings → API. **Never** put this in the dashboard's `VITE_` variables |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `SHOPIFY_APP_URL` | Same screen (Vercel → **verafo-shopify** → Environment Variables) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_ADMIN_EMAILS` | Vercel → project **verafo** → Settings → Environment Variables |

---

## 3. Backup before touching anything

You cannot undo a deploy, so take a copy first.

1. **Webhook config.** Copy the current `apps/shopify/shopify.app.toml` to a safe
   place outside the repo, e.g. `shopify.app.toml.backup`.
2. **Dashboard.** In Vercel → project **verafo** → **Deployments**, find the
   currently live deployment and copy its URL. That is your rollback target.

There is nothing to back up for `store_plans`, because the table does not exist
yet. Step A creates it.

---

## 4. Do these in this order

The order matters. The webhook code must be live **before** Shopify is told to
start sending the webhook, or Shopify will send events to a URL that does not
exist yet.

### Step A — Create the database table

**Why first:** the webhook writes to this table. Without it, the webhook fails.

1. Open **Supabase** → your **Verafo** project → **SQL Editor** → **New query**.
2. Open the file `supabase/store-plans-migration.sql` from this repo and paste the
   whole file into the editor.
3. Press **Run**.

**Success looks like:** "Success. No rows returned".

**If it fails:**
- `relation "stores" does not exist` → the Shopify migration was never run. Run
  `supabase/shopify-migration.sql` first, then run this file again.
- `permission denied` → you are not in the Verafo project, or you are not the
  project owner. Switch to the correct project.
- Re-running this file is safe. It uses `create table if not exists` and
  `drop policy if exists`.

### Step B — Put the webhook code live

**Why:** the new handler file must be running before Shopify is told to use it.

The webhook code is on the branch `feature/plan-webhook`. It goes live by
**merging a GitHub pull request into `main`**. That merge is what puts the code on
the server. Do not run `git push` from a redesign branch, and do not merge the
redesign branch.

1. Open this pull request page in a browser:
   `https://github.com/Sufyanover9k8/verafo/pull/new/feature/plan-webhook`
2. Set the **base** branch to `main` and the **compare** branch to
   `feature/plan-webhook`.
3. Check the files list. It must show only the plan-webhook files — no redesign
   files. If you see redesign files, stop and do not merge.
4. Press **Create pull request**, then **Merge pull request**.
5. Vercel project **verafo-shopify** deploys from `main`, so it redeploys by
   itself. Go to Vercel → project **verafo-shopify** → **Deployments** and wait
   for the new deployment to say **Ready**.

**Success looks like:** the pull request is merged into `main`, and the newest
deployment in **verafo-shopify** is **Ready**.

**If it fails:** open the failed deployment → **Build Logs**. The usual cause is a
missing environment variable. Fix the variable, then Vercel → **Deployments** →
**Redeploy**.

### Step C — Tell Shopify to send the new webhook

**Why:** the entry in `shopify.app.toml` only takes effect after a deploy.

1. Open a terminal in the folder `apps/shopify`.
2. Run:

```
cd apps/shopify
shopify app deploy
```

3. Confirm the prompt. This pushes the app configuration, including the new
   `app_subscriptions/update` webhook.

**Success looks like:** the command prints a new app version, and no error.

**If it fails:**
- "Not authenticated" → run `shopify auth login`, then try again.
- "No app found" → run `shopify app config link` and pick the Verafo app, then try again.
- If you are not sure the deploy worked, check Shopify Partner Dashboard → your
  app → **API access** / webhook list for `app_subscriptions/update`.

**Note:** this command deploys configuration only. It does **not** change plan
prices, plan names, scopes or the API version.

### Step D — Deploy the dashboard

**Why last:** the badge is cosmetic. If the earlier steps are wrong, you want to
find out before the dashboard changes.

1. Open a terminal in the **repo root** (this folder).
2. Run:

```
vercel --prod --archive=tgz
```

**Success looks like:** the command prints a production URL, and opening
`verafo.vercel.app` shows the dashboard as before.

**If it fails:** a second command does the same thing — Vercel → project
**verafo** → **Deployments** → **Redeploy**.

**Important:** do **not** deploy the dashboard until the dashboard redesign has
been tested. The badge files (`src/hooks/use-plan.ts` and
`src/components/app/plan-badge.tsx`) are **not** part of this change. They live on
the redesign branch and will ship with it later. This change is
database + webhook only. If you are only doing this change, you can skip Step D.

---

## 5. How to test on the test store

The test store is **test-verafo**, a development store.

1. **Switch the plan.** In the Shopify admin for **test-verafo**, open the Verafo
   app. Go to its pricing page and choose a plan. Switch between **Free**,
   **Standard** and **Advanced**, and check the table again after each one.
2. **Wait a few seconds.** Shopify sends the webhook right away.
3. **Check the table.** Supabase → **SQL Editor** → run:

```sql
select plan_name, status, updated_at
from store_plans;
```

**Success looks like:** one row, and `plan_name` matches the plan you picked,
exactly as Shopify spells it — `Free`, `Standard` or `Advanced`. Each time you
switch plan, `updated_at` moves and `plan_name` changes. The `status` column
should be `ACTIVE`.

**If no row appears:**
- Give it 30 seconds and run the query again. Webhooks are fast, not instant.
- Check the webhook is registered: Shopify Partner Dashboard → your app →
  the webhook list. You should see `app_subscriptions/update`.
- Check the handler logs: **Vercel → project `verafo-shopify` → Deployments → the
  live deployment → Runtime Logs**. Look for the line
  `Received app_subscriptions/update webhook for …`.
  - If you see `No active subscription for …; nothing written.` then Shopify
    reports no subscription. Re-select a plan and check again.
  - If you see `store_plans upsert failed`, the table is missing or
    `SUPABASE_SERVICE_ROLE_KEY` is wrong. Re-check Step A and the env var.
- Check the store is linked: Supabase → SQL Editor →
  `select * from stores where shopify_domain is not null;`
  If the test store has no row, open the Verafo app in the Shopify admin once and
  press its sync button, then re-select the plan.
- **Remember:** with no row, the badge stays hidden. That is correct behaviour,
  not a bug. It is never shown as "Free" by default.

4. **Check the badge.** This only works after a later change places the badge on
   the Overview screen. Once it does: sign in to `verafo.vercel.app` as the
   merchant whose `stores.owner_email` owns the test store, and look at the
   Overview header. You should see the plan name in a small teal pill, spelled
   exactly as Shopify spells it.

---

## 6. How to undo everything

Do these in any order. The first one is the only one that destroys data.

**The database table** (this deletes the stored plans — the webhook will simply
write them again next time):

```sql
drop table if exists store_plans;
```

**The webhook entry:** remove the `app_subscriptions/update` block from
`apps/shopify/shopify.app.toml`, then run `shopify app deploy` again from
`apps/shopify`. Shopify stops sending the webhook. The handler file can stay; it
is harmless once nothing calls it.

**The webhook code:** delete
`apps/shopify/app/routes/webhooks.app.subscriptions_update.tsx` and push. Vercel
redeploys `verafo-shopify` automatically.

**The dashboard:** Vercel → project **verafo** → **Deployments** → find the
previous good deployment (the URL you wrote down in step 3) → **⋯** →
**Promote to Production**.

**The badge in the code:** delete `src/hooks/use-plan.ts` and
`src/components/app/plan-badge.tsx`. If a later change imported `<PlanBadge />`,
remove that import and its usage too, then run
`vercel --prod --archive=tgz` from the repo root.

Nothing else needs undoing. No plan, price or subscription is ever changed by
this feature, so there is nothing to restore on Shopify's side.

---

## 7. Final checklist

- [ ] Node.js 20.19+ — `node --version` works
- [ ] Shopify CLI installed and logged in — `shopify version` works
- [ ] Vercel CLI installed and logged in — `vercel --version` works
- [ ] I can open the Supabase **Verafo** project, the Shopify Partner app, and the Vercel project **verafo**
- [ ] I checked the hosting situation for the Shopify app (**Vercel project `verafo-shopify`**)
- [ ] I made a backup / noted the current state (step 3)
- [ ] **Step A** — `supabase/store-plans-migration.sql` ran in the Supabase SQL Editor
- [ ] **Step B** — the webhook file is pushed and `verafo-shopify` shows **Ready**
- [ ] **Step C** — `shopify app deploy` ran with no error
- [ ] **Step D** — `vercel --prod --archive=tgz` ran from the repo root
- [ ] Tested on **test-verafo**: switched plan, saw a row in `store_plans`
- [ ] The stored `plan_name` matches Shopify's spelling exactly (not renamed)
- [ ] I know where the logs are: **Vercel → `verafo-shopify` → Deployments → Runtime Logs**
- [ ] I know the rollback: promote the previous **verafo** deployment, or `drop table store_plans`
