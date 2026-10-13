# RUNBOOK — buyer privacy release

Plain words, numbered steps. Nothing in this file is a secret: **never put a
key, token or password in this guide** (or in any file in the repo).

What the release is made of:

| file | what it does |
| --- | --- |
| `supabase/buyer-privacy-stage-a.sql` | adds the safe functions (lookup by phone, similar buyers, phone normaliser). Touches no policy. |
| `supabase/aggregate-stats-migration.sql` | aggregate stats get a 3-store / 10-order floor; buyer ranking becomes per-store (`p_store_ids`). |
| `supabase/buyer-privacy-stage-c.sql` | the lockdown: buyers, chats, chat_messages, verafo_admins, `verafo_config`, and the public (anon) function surface. |
| `supabase/privacy-isolation-tests.sql` | proof, with fake data, that A cannot touch B. |
| `supabase/lock-shopify-tables.sql` | locks the Shopify app's own tables (already done by hand on 2026-10-10). |
| `supabase/rollback-*.sql` | the way back for Stage A, aggregate-stats and Stage C. |

---

## 1. Practice project first (never test on production)

1.1 Make a **free** Supabase project. Call it something like `verafo-practice`.
1.2 In that project only, turn **Authentication → Providers → Email →
    "Confirm email" OFF**, so you can create test users and sign in with them
    straight away. (In production it must stay **ON**.)
1.3 Turn the **vector** extension on: Database → Extensions → search `vector`
    → enable. (`create extension if not exists vector;` in the SQL editor does
    the same thing.)
1.4 Open the SQL editor. Run the base files **in this order**, one at a time,
   pasting the whole file and pressing Run. Wait for each to say Success
   before starting the next.

```
1. supabase/schema.sql
2. supabase/shopify-migration.sql
3. supabase/store-plans-migration.sql        <-- ADDED: the plan badge reads this table
4. supabase/admin-dashboard.sql
5. supabase/stores-migration.sql             (if it fails, see 1.5)
6. supabase/chats-migration.sql
7. supabase/order-decisions-migration.sql    <-- ADDED: Decide page + the tests use it
8. supabase/features-migration.sql
9. supabase/kpis-rpc.sql
10. supabase/rls-production.sql              (always last of the base files)
```

   Skip `supabase/lookups-migration.sql`: `schema.sql` already creates the
   `lookups` table, and `rls-production.sql` adds its `owner_email` column.

1.5 **If `stores-migration.sql` fails** with "cannot change return type of
   existing function" (it re-creates `store_overview()` with more columns),
   run this first and then the file again:

```sql
drop function if exists store_overview();
```

1.6 Things to know about the order (I read every file header):
   * the order above is **right**, with two additions: `store-plans-migration.sql`
     (its header says "after shopify-migration.sql") and
     `order-decisions-migration.sql` (the Decide page and the privacy tests
     need that table);
   * `features-migration.sql` must stay **before** `rls-production.sql` — the
     first re-creates the scoring functions, the second is what makes them
     `SECURITY DEFINER`. (Both files now carry the marker, so this is belt and
     braces, but keep the order);
   * `rls-production.sql` inserts two real admin emails. In the practice
     project you may replace them with practice addresses; leaving them means
     those two accounts are admins there;
   * `lock-shopify-tables.sql` is only needed where the Shopify Prisma tables
     exist (production), not in a fresh practice project.

---

## 2. Run the privacy files in the practice project

2.1 **Stage A** — run `supabase/buyer-privacy-stage-a.sql`.
   *Success looks like:* "Success. No rows returned". It adds 5 functions.

2.2 **Aggregate stats** — run `supabase/aggregate-stats-migration.sql`.
   *Success:* "Success. No rows returned".

2.3 **The tests** — run `supabase/privacy-isolation-tests.sql`.
   *Success looks like:* a long list of `PASS | …` lines in the notices, then
   two result tables. **Before Stage C, FAILs on `buyers`, `chats`,
   `chat_messages`, `verafo_admins`, `verafo_config` and the anon-callable
   functions are EXPECTED** — those open policies are still in place. The last
   table's `failures` count is *not* zero yet.
   The file ends in `ROLLBACK`, so all fake data disappears.

2.4 **Stage C** — run `supabase/buyer-privacy-stage-c.sql`.
   *Success:* "Success. No rows returned". If it stops with
   `Stage C failed: buyers still carries N permissive policy row(s) …`, run the
   query in the hint, drop those extra policies, and run Stage C again.
   (Nothing is applied when it fails — the whole file is one transaction.)

2.5 **The tests again** — run `supabase/privacy-isolation-tests.sql`.
   *Success looks like:* **every line reads `PASS`** and the last table shows
   `failures = 0`.

2.6 Optional: run `supabase/seed.sql` for demo rows, then sign in with two
   practice users and click around.

---

## 3. Production

> 🔴 = breaking, or hard to undo. ⚪ = safe.

3.1 🔴 **Back up first.** Dashboard → Project Settings → Database → Backups
   (take a manual backup), or from the CLI with your database password already
   in your environment (never written into a file):

```
supabase db dump --project-ref <PROJECT-REF> -f backup-before-privacy.sql
```

3.2 ⚪ **Confirm email must be ON** in production: Authentication → Providers →
   Email → "Confirm email" enabled.

3.3 ⚪ **Read-only check: chats.** Paste this into the SQL editor and keep the
   numbers:

```sql
select count(*) as chats, count(created_by) as with_owner from chats;
```

   `with_owner` counts the chats that already carry an owner. Stage C only lets
   a user see chats where `created_by = auth.uid()`, so any chat counted in
   `chats` but not in `with_owner` becomes **invisible** (not deleted) after
   Stage C. Decide before Stage C: attribute them by hand, or leave them
   hidden. **We do not backfill automatically** — nothing on the row says who
   owned it. (If the query errors with "column created_by does not exist", the
   column is missing: Stage C adds it, and *every* existing chat becomes
   invisible. Say so before running Stage C.)

3.4 ⚪ **Read-only check: are the Shopify tables already locked?**
   (They were locked by hand on 2026-10-10.)

```sql
select c.relname,
       c.relrowsecurity as rls_on,
       has_table_privilege('anon', c.oid, 'SELECT')          as anon_can_read,
       has_table_privilege('authenticated', c.oid, 'SELECT') as users_can_read
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('Session', 'ShopSetup', '_prisma_migrations');
```

   *Success:* every row shows `rls_on = true`, `anon_can_read = false`,
   `users_can_read = false`. If a row is missing, that table is not in this
   database (nothing to do). If a row shows `false`/`true`/`true`, run
   `supabase/lock-shopify-tables.sql` (safe and repeatable).

3.5 ⚪ **Stage A** — run `supabase/buyer-privacy-stage-a.sql`.
   Nothing in the running app changes: it replaces two functions that do not
   exist in production yet and adds helpers.

3.6 🔴 **Aggregate stats** — run `supabase/aggregate-stats-migration.sql`.
   For a short window the *deployed* edge function's "top buyers" question
   returns an empty list instead of an error, because the old call has no
   `p_store_ids` and an empty store list ranks nobody. Keep this window short
   by doing 3.7 straight away. (Deploying the edge function first would instead
   error, so this order is the safe one.)

3.7 🔴 **Deploy the frontend and the edge function together.**
   Why together: the trends payload's riskiest-buyers list was renamed from
   `phone` to `buyer` (masked labels only). An old frontend with the new edge
   function shows blank/`undefined` buyers; a new frontend with the old edge
   function does the same. Ship both, then hard-refresh.

   Edge function (from the repo root; `supabase/config.toml` already sets
   `verify_jwt = false` and the function verifies the caller's token itself, so
   do not add `--no-verify-jwt`):

```
supabase functions deploy verafo-ai --project-ref <PROJECT-REF>
```

   These secrets must **already** be set on the project — names only, values
   never written down here or anywhere else:

```
SUPABASE_URL
SUPABASE_ANON_KEY            (or SUPABASE_PUBLISHABLE_KEY)
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
```

   Check the names (this lists names and digests, not values):

```
supabase secrets list --project-ref <PROJECT-REF>
```

   Frontend: build and publish the web app the same way you normally do, from
   the same commit as the edge function.

3.8 ⚪ **Two-account manual test** (two real accounts, each with its own store):
   1. Sign in as account 2. Dashboard loads; the buyer-risk chart and the
      "riskiest buyers" list show masked labels (`····1234`), no phone numbers.
   2. Account 2 → Settings → "Export buyers": only account 2's own buyers.
   3. Account 2 → Buyer Lookup with a number that only account 1 has ordered
      from: you get the risk verdict and counts (that is the product), and
      **no name, no store name, no full number of anyone else**.
   4. Account 2 → New Order with a brand-new number: the order saves and the
      preview shows the score (this proves the stub insert still works).
   5. Repeat step 4 with a number that already exists (a second order for the
      same buyer): it must save too.
   6. Account 2 → Ask Verafo → "show me the top buyers": counts and masked
      labels only.
   7. Sign out and try the same URLs by hand: you land on the login screen.

3.9 🔴 **Stage C** — run `supabase/buyer-privacy-stage-c.sql`.
   This is the step that closes the exposure, and the least reversible one. It
   is one transaction: any failed self-check rolls the whole file back.

3.10 ⚪ **Final checks after Stage C**
   1. `select policyname, cmd, qual from pg_policies where schemaname='public'
      and tablename='buyers' order by policyname;` → only
      `buyers insert neutral stub` and `buyers read own`.
   2. Repeat 3.8 (the two-account test). Everything must still work.
   3. In the **practice** project, run
      `supabase/privacy-isolation-tests.sql` one last time on the same file
      versions that production has → `failures = 0`.
   4. Watch the chat list for a day: hidden legacy chats show up as "missing"
      conversations (see 3.3).

---

## 4. If something goes wrong (rollbacks)

Do these in the SQL editor. Each one is a single transaction.

| symptom | file to run | notes |
| --- | --- | --- |
| Buyer Lookup / New Order preview fails after Stage A | `supabase/rollback-buyer-privacy-stage-a.sql` | drops the 5 functions; no policy changes |
| "top buyers" empty or broken | `supabase/rollback-aggregate-stats.sql` | 🔴 goes back to network-wide ranking and to raw refusal_reason text; redeploy the old edge function too |
| Production is badly broken after Stage C | `supabase/rollback-buyer-privacy-stage-c.sql` | 🔴 re-opens everything: every buyer row (embedding included), the admin list and all chats become readable by any signed-in user, and the public key can call the functions again. Fix forward and re-apply Stage C as soon as you can |

Notes:
* Stage C never deletes data. Rolling it back brings the old visibility back,
  including chats that were hidden by 3.3.
* `lock-shopify-tables.sql` has its own rollback at the bottom.

---

## 5. Rules that must never be broken

**⚠️ NEVER RE-RUN `supabase/schema.sql` OR `supabase/features-migration.sql`
AFTER STAGE C.** Both files re-create the scoring functions
(`recompute_buyer`, `on_order_change`, `on_outcome_change`), and they used to
write them **without** `SECURITY DEFINER`. That marker is the only reason the
risk score still updates when a merchant logs an order after Stage C removed
the buyers UPDATE path — re-running an old copy silently stops every score
update. (All copies in this repo now carry the marker, and Stage C re-asserts
it and checks it, but the two files also re-open the demo anon policies, so
treat them as never-run-again.)

**⚠️ `verafo_config`**: Stage C revokes it from `anon` and `authenticated` and
turns row level security on, because nothing in this repo reads or writes it.
If something outside this repo reads `verafo_config` with the public key, it
will break; restore access with a **single-column grant only**
(for example `grant select (public_key_column) on verafo_config to anon;`),
never by re-opening the whole table.

**⚠️ Never run `supabase/privacy-isolation-tests.sql` on production.** It
creates fake merchants and would be meaningless there.

**⚠️ Never put a key, token or password in this file or any other file.**
