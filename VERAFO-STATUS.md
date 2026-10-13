# VERAFO STATUS

Last updated: this session. Author: engineering agent.

> **READ THIS FIRST.** Verafo has a **live cross-merchant data exposure in
> production**. Code-level fixes are written but **nothing has been deployed
> and no SQL has been run**. The exposure is still open. See section 2.

---

## 0. PERMANENT PRODUCT REQUIREMENTS

These are standing product rules, confirmed by the product owner. They apply
to Ask Verafo, Buyer Passport, Lookalike Audiences, and every future feature
that touches buyer or order data. Do not weaken them for convenience.

**R1 - Cross-store intelligence is ALLOWED.** Network-wide aggregate
statistics, risk trends, order counts and similarity insights are a feature of
the product and are expected to improve as more merchants join.

**R2 - Private order data is RESTRICTED.** Addresses, cities, individual
orders, order amounts, and any identifiable customer information may be
accessed **only** for the merchant's own authorized stores.

**R3 - Phone lookup is PRIVACY-SAFE.** A merchant may enter a phone number
they already know and receive **aggregate network risk intelligence** about
it. They must never receive another merchant's identity, individual orders,
addresses, or customer phone numbers.

**R4 - Similar buyers are AGGREGATE ONLY.** Never expose another buyer's
phone number, identifiable record, or raw embedding. Similarity is a
behavioural resemblance, never a risk verdict and never evidence of fraud.

**R5 - Edge functions must authorize explicitly.** Any function holding
`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It must therefore: validate the
caller's authentication; derive the caller's authorized store ids itself;
scope every private query to those ids; treat "no owned stores" as DENY, never
as "no filter"; and never rely on the frontend for a restriction.

**R6 - Results must be honest.** Clearly distinguish observed data from
estimates. Limited history must not imply high risk - it is missing
information. Never fabricate statistics, savings, or prevented losses.

**R7 - Tenant isolation is enforced in the database**, not only in the UI. A
missing column or a permissive policy is never a reason to expose data.

---

## 1. The product, confirmed

The standalone Verafo product is the **repository root**
(`C:\Users\lavee\Desktop\Verafo\verafo-frontend`):

- `package.json` name `verafo`, React 19 + Vite 6 + TypeScript
- root `vercel.json` with SPA rewrites, so this folder is the Vercel project **verafo**
- Supabase (Postgres + pgvector + RLS) is the backend

`apps/shopify/` is a **separate integration** (Remix, Prisma). Nothing in
`src/` imports it. Confirmed by search, not assumption.

---

## 2. PRODUCTION SECURITY INCIDENT

### 2.1 Root cause

`supabase/rls-production.sql` line 253:

```sql
create policy "buyers read" on buyers for select to authenticated using (true);
```

`buyers.phone` is the **primary key**. `using (true)` therefore let **any
signed-in merchant read every buyer row on the entire network, phone numbers
included.** The file's own comment acknowledges the fingerprint problem and
defers it as a follow-up; the follow-up was never done.

### 2.2 Every exposure path found

| # | Path | File | Status |
|---|---|---|---|
| 1 | "Download all buyer profiles" exported every merchant's customer phone numbers, unfiltered | `src/pages/Settings.tsx` | **Fixed in code** |
| 2 | Lookup read `select('*')`, pulling `embedding` (1536-dim fingerprint) and `feature_vector` into the browser | `src/pages/Lookup.tsx` | **Fixed in code** |
| 3 | `find_similar_buyers()` is plain SQL, ran under caller RLS, and **returned `phone`** | `supabase/schema.sql:220` | **Revoked in the migration (not yet run)** |
| 4 | Chat mention search ran `ilike('phone','%digits%')` with no store filter — an interactive phone-number enumeration endpoint | `src/pages/Chat.tsx` | **Fixed in code** |
| 5 | New Order live preview read `select('*')`, same fingerprint exposure | `src/pages/NewOrder.tsx` | **Fixed in code** |
| 6 | **`verafo-ai` edge function uses the SERVICE ROLE key, so it bypasses RLS entirely.** `toolSimilarBuyers` returns **other merchants' phone numbers**; order tools read `address` and `city` across all stores with **no `store_id` scoping and no caller verification** | `supabase/functions/verafo-ai/index.ts` | **NOT FIXED** |

Path 6 is the most serious remaining item. It is not covered by the SQL
migration, because the service role is deliberately exempt from RLS.

### 2.3 What is safe today

Nothing, until section 5 is executed. Paths 1-5 remain exploitable in
production with the currently deployed front end.

---

## 3. Code-level fixes completed

### 3.1 New SQL: three files, split so each step is safe on its own

The single `buyer-privacy-migration.sql` was **deleted** and split, because
applying the policy narrowing and the new functions together was not safe.

| File | Contains | Safe alone? |
|---|---|---|
| `supabase/buyer-privacy-stage-a.sql` | the three functions + grants. **No policy change, no revoke.** | **Yes** |
| `supabase/aggregate-stats-migration.sql` | `verafo_aggregate_stats`, `verafo_buyer_ranking` | **Yes** |
| `supabase/buyer-privacy-stage-c.sql` | narrows the `buyers` policy, revokes `find_similar_buyers`, self-check | **No - only after A and the deploy** |

Additive and reviewed. It does **not** weaken authentication or drop any
existing protection.

1. **`verafo_normalize_phone(text)`** — strict input validation. Only a real
   Pakistani mobile or landline shape reaches the query, so the PostgREST
   surface cannot be probed with partial strings. `immutable`,
   `set search_path = public, pg_temp`, not granted to `anon` or `public`.
2. **Narrowed `buyers` read policy** (Stage C) — a merchant sees only buyers who
   have an order in one of their own stores, plus admins. The scoring pipeline
   is unaffected: `recompute_buyer` and its triggers are `SECURITY DEFINER`.
3. **`buyer_network_lookup(phone)`** — preserves the product promise (any known
   number returns a verdict) while returning **aggregates only**: risk score,
   order counts, accepted, refused, store count, first seen. No phone, no
   identity, no store identity, no order detail, no vector.
4. **`similar_buyers_by_phone(phone, limit)`** — takes a phone, so the vector
   never leaves the database; returns similarity plus aggregate counts and
   **no phone number**, so the result cannot become a contact list.
5. **`verafo_aggregate_stats(p_dimension, p_days)`** — the aggregate path that
   replaces "read every order row and group in JavaScript". `buyers` is a
   **COUNT**, never a number.
6. **`verafo_buyer_ranking(p_metric, p_limit, p_days)`** — ranks in Postgres and
   returns `buyer_label` as `'····' || right(phone, 4)`. The full number never
   leaves the database.
7. **Explicit grants** — `revoke all ... from public, anon` then
   `grant execute ... to authenticated` on all of them. Every function is
   `SECURITY DEFINER` with a pinned `search_path`.
8. **`find_similar_buyers` revoked** from `authenticated` and `anon`.
9. **Self-check** — Stage C raises an exception if `buyers` still has an
   unrestricted SELECT policy, so it fails loudly rather than appearing to
   succeed.
10. Rollback block included at the bottom of each file.

### 3.2 Frontend changes

| File | Change |
|---|---|
| `src/pages/Settings.tsx` | Export resolves buyers from **this store's orders**, selects explicit columns, and passes `canExportAudience` before writing. Unauthorized = **no file**. |
| `src/pages/Lookup.tsx` | RPC-based (`buyer_network_lookup`, `similar_buyers_by_phone`). No `select('*')`. Similar buyers list is informational and states plainly that other buyers' numbers are not shown. |
| `src/pages/NewOrder.tsx` | RPC-based. No `select('*')`. |
| `src/pages/Chat.tsx` | Minimum 6 digits before suggesting, and the read is now confined by the `buyers` policy. |
| `src/pages/BuyerMap.tsx` | Filter moved into the query; the network buyer list no longer leaves the database. |
| `src/lib/types.ts` | `embedding` / `feature_vector` marked optional and documented as never returned. `SimilarBuyer.phone` optional and documented as absent. |
| `src/lib/ui/audiences.ts` (new) | Segments, Buyer Passport, and `canExportAudience` — the single authorization point for exports. |
| `src/lib/ui/analytics.ts`, `scan.ts`, `simulate.ts`, `phone.ts`, `csv.ts`, `money.ts`, `prefs.ts` | Insight engine, historical scan, what-if simulator, phone parsing, CSV safety, formatting. |

### 3.3 Features built before this incident work

Dashboard verdict card with score ring, briefing line, one-tap Call /
WhatsApp / Copy, money-at-risk cards, auto-refresh, first-run checklist,
`/orders/decide`, `/orders/scan`, `/simulate`, dashboard insight cards.

---

## 4. Verification results — separated by level

### 4.1 Code level (actually run)

| Check | Result |
|---|---|
| `deno check --node-modules-dir=auto supabase/functions/verafo-ai/index.ts` | **exit 0. 0 errors.** Deno 2.9.7 / TypeScript 6.0.3 |
| `npm test` | **261 passed / 261, 16 files** |
| `npx tsc -b` | **exit 0** |
| `npm run build` | **exit 0** |
| `as any` in the edge function | **0** (was 28) |
| `: any` annotations in the edge function | **36** - see "Remaining code debt" below |
| `select('*')` on `buyers` in real code | **none** |
| Explicit `embedding` / `feature_vector` reads in `src/` | **none** |
| `find_similar_buyers` calls from the frontend | **none** |
| Source encoding | all valid UTF-8, no mojibake |

**Tests passing is not evidence that the security fix works.** The tests prove
the *logic*: export authorization, segment rules, aggregate-only shapes,
formula-injection defence, read-only simulation. They do not prove that a real
request from a real merchant against a real database returns no other
merchant's data. Only staging can show that.

### 4.2 Staging verification

**Not performed. No staging environment has been used in this session.**

### 4.3 Production verification

**Not performed.** Nothing has been deployed and no SQL has been run.

---

## 5. The coordinated release plan

### 5.0 CORRECTION TO THE EARLIER PLAN - SQL STAGE A GOES FIRST

The previous version of this document said to deploy the frontend first. **That
was wrong.** I verified it: `buyer_network_lookup`, `similar_buyers_by_phone`
and `verafo_normalize_phone` **do not exist in production**. They exist only in
the stage SQL files. The updated frontend already calls them, so deploying the
frontend first would break Buyer Lookup and the New Order preview immediately.

The correct order is below. The migration is split into two files so that step
1 is safe on its own.

| Stage | File / action | Breaks nothing? |
|---|---|---|
| **A** | `supabase/buyer-privacy-stage-a.sql` - adds the three functions and their grants. **No policy change, no revoke.** | **Yes, safe alone.** The old frontend and edge function keep working. |
| **B** | Deploy the updated frontend, then the updated edge function. | Yes - the functions now exist. |
| **C** | `supabase/buyer-privacy-stage-c.sql` - narrows the `buyers` policy, revokes `find_similar_buyers`, runs a self-check. | **No - only run after A and B.** |

### Step 1 - Apply Stage A

Supabase SQL Editor, Verafo project, paste `buyer-privacy-stage-a.sql`, Run.
Then paste `aggregate-stats-migration.sql`, Run.
Expect "Success. No rows returned" from both. Nothing in production behaviour
changes.

Verify all five functions exist:

```sql
select proname from pg_proc where proname in (
  'buyer_network_lookup','similar_buyers_by_phone','verafo_normalize_phone',
  'verafo_aggregate_stats','verafo_buyer_ranking'
);
```

This must return **five rows**. The updated edge function calls
`verafo_aggregate_stats` and `verafo_buyer_ranking`, so deploying it before
these exist breaks Ask Verafo's aggregate questions.

### Step 2 - Deploy the frontend, then the edge function

Frontend first (Vercel project **verafo**). Then the edge function
(`verafo-ai`). Sanity check: Buyer Lookup, New Order live preview, Similar
buyers, Buyer Map, Chat mentions, Settings export, Ask Verafo.

### Step 3 - Apply Stage C

Only after step 2 is verified. Expect "Success. No rows returned". If it raises
`Stage C failed: buyers still has an unrestricted SELECT policy`, the fix did
not apply - investigate before continuing.

### Step 4 - Production verification

See section 7.

### Rollback

Each SQL file carries its own rollback block. Reverting the frontend is a
Vercel redeploy of the previous deployment. Stage A's rollback is safe at any
time; Stage C's rollback restores the leaky policy and should only be used for
recovery.

### Known gap in Stage B (must be fixed before Stage C)

**Update: the edge function is now scoped in code, with one deliberate
trade-off left for you to accept or change.**

What was done:

- `authorizeCaller(req)` verifies the caller's JWT against Supabase Auth and
  derives their owned store ids. Returns `[]` on any failure.
- **14 `requireOwnStores(storeIds)` guards** now gate every private-data tool:
  `search_orders`, `buyers_by_city`, `buyer_profile`, `top_buyers`,
  `city_overview`, `category_overview`, `store_overview`, `top_products`,
  `refusal_reasons`, `weekly_trend`, `buyer_orders`, `buyer_verdict`,
  `search_buyers`, and `buildFileSpec` (the file-generation path).
- `storeIds` is threaded through `runAgentTool(name, args, supabase, openai,
  storeIds)` to every one of those tools, so no case can silently default to
  an empty list.
- `toolSimilarBuyers` no longer reads `buyers.embedding` and no longer calls
  `find_similar_buyers`; it uses `similar_buyers_by_phone` and returns no
  phone numbers.
- **A privacy backstop was added inside `fetchRows`.** The edge function runs
  on the service role, so RLS cannot help. Any query against a private table
  (`orders`) that is not filtered by `store_id` now **throws** rather than
  returning the network. A leak that throws is found immediately; a leak that
  returns `[]` looks like "no data" and can survive for months.

**The deliberate trade-off - RESOLVED (Option 2, aggregate RPCs).**

All four dimension-based aggregate tools now compute their figures in the
database and never read `orders` raw:

| Tool | Now calls | Notes |
|---|---|---|
| `toolCityOverview` | `verafo_aggregate_stats('city')` | counts only |
| `toolCategoryOverview` | `verafo_aggregate_stats('category')` | counts only |
| `toolTopProducts` | `verafo_aggregate_stats('product')` | counts only |
| `toolRefusalReasons` | `verafo_aggregate_stats('reason')` | reason is a chosen label, not free text |
| `toolWeeklyTrend` | `verafo_aggregate_stats('week')` | sorted chronologically |
| `toolTopBuyers` | `verafo_buyer_ranking` | **masked label, no phone** |

`toolTopBuyers` was the worst single finding in the whole audit: it read the
entire `buyers` table and returned **every buyer's phone number across the
network**. It now returns a rank, a masked label (last 4 digits only), and
aggregate counts. Ranking without an identity still answers "how many reliable
buyers do I have, and what are they worth?".

**Order reads that remain fail-closed**, which is safe but means those
questions error rather than answer:

- `buildChartData` is scoped to the caller's stores (so it works).
- `toolStoreOverview` compared **other stores by identity**, which is private
  data. This is now fixed: it takes `storeIdFilter(storeIds)` so it only ever
  compares the caller's **own** stores, and it is still gated by
  `requireOwnStores()`. A cross-merchant store comparison is deliberately not
  offered, because store identity is private data.
- The `fetchRows` backstop means any remaining unscoped read **throws**
  instead of leaking. Nothing currently relies on that throw.

### New SQL required (written, NOT executed)

`supabase/aggregate-stats-migration.sql` - apply in **Stage A**, alongside
`buyer-privacy-stage-a.sql`:

- `verafo_aggregate_stats(p_dimension, p_days)` - returns `bucket, orders,
  buyers, value, accepted, refused, pending, refusal_rate`. `buyers` is a
  **COUNT**, never a number. `SECURITY DEFINER`, pinned `search_path`,
  revoked from `public` and `anon`, granted to `authenticated`.
- `verafo_buyer_ranking(p_metric, p_limit, p_days)` - returns `rank,
  buyer_label, orders, accepted, refused, value, risk_score, store_count`.
  `buyer_label` is `'····' || right(phone, 4)` - the full number never
  leaves Postgres.

The refactored edge function calls both functions, so deploying it before they
exist breaks Ask Verafo's aggregate questions. It creates two functions and
modifies nothing.

### The edge function IS now type-checked - and it found real bugs

Earlier versions of this document said Deno was unavailable. That is no longer
true: Deno 2.9.7 (TypeScript 6.0.3) is installed at
`~/.deno/bin/deno.exe` and **is** reachable from this environment. The command
below now exits **0**:

```
deno check --node-modules-dir=auto supabase/functions/verafo-ai/index.ts
```

Reaching that state fixed **33 type errors**, and several of them were not
cosmetic:

1. **`storeIdFilter()` returned `""` for a caller with no owned stores.** The
   empty string *removed* the filter, so the "merchant owns no store" case read
   **every merchant's orders**. It now returns `&store_id=eq.__verafo_no_owned_store__`,
   which can never match, so the query still carries a `store_id=` filter (the
   `fetchRows` backstop sees it) while returning zero rows. This was a live
   fail-open path in the fix itself.
2. **`fetchStats()` and `buildFeatureVector()` read orders unfiltered.** They
   filtered only by `buyer_phone`, so a merchant looking up a number saw that
   buyer's order-level detail - prices, cities, addresses - across **all**
   stores. Both now take `storeIds` and apply `.in("store_id", storeIds)`.
3. **`buildFeatureVector()` selected `embedding` and `feature_vector`** via
   `select("*")` even though it only needed two columns. Narrowed to
   `phone, first_seen, total_accepted`.
4. **`toolSearchBuyers()` was a network-wide enumeration endpoint.** It ran
   `phone ilike '%<digits>%'` against the entire `buyers` table. Because
   `buyers.phone` is the primary key, walking prefixes harvested every buyer's
   phone number. Partial searches are now **refused**; a complete number returns
   one buyer's aggregate row (which is the product decision - any known number
   resolves, even a buyer who never ordered from your store), and with no number
   the tool returns `verafo_buyer_ranking` masked output.
5. **`toolStoreOverview()` read orders with no store filter at all.** It was
   failing closed only incidentally. It is now explicitly scoped *and* still
   guarded by `requireOwnStores()`.
6. **`listChatHistory()` had lost its `return`** and would have handed
   `undefined` into the model's message array. Restored and typed.

### File-integrity incident (resolved)

Ten em dashes, one ellipsis and the runtime masked-label literal `"····"` were
corrupted into mojibake by PowerShell `Set-Content` (which writes cp1252, not
UTF-8), and a misplaced closing brace left the file with 4 real parse errors.
Both are fixed and now guarded by tests:

- The mojibake was reversed by applying the cp1252 round-trip inverse until the
  text stabilised at exactly 10 em dashes, 4 middle dots and 1 ellipsis.
- `src/lib/ui/edge-privacy.test.ts` now fails the build if `as any`, mojibake
  (A-tilde / A-circumflex style sequences), or a damaged `"····"` masked-label
  literal reappears in the edge function. The test file builds its mojibake
  pattern from escapes so that it does not trip its own scan.

**Rule for future edits: never write this file with `Set-Content` / `Out-File`.
Use the file-writing tool or `[System.IO.File]::WriteAllText` with an explicit
UTF-8-no-BOM encoding.**

### Verification status of the edge function changes

| Level | Status |
|---|---|
| Syntax (TS parser) | **Run. 0 errors.** |
| Types (`deno check`) | **Run. exit 0, 0 errors.** |
| Unit tests of the authorization rules | **Run. 21 tests, passing** (`src/lib/ui/edge-authz.test.ts`) |
| Source-invariant guards on the edge function | **Run. 10 tests, passing** (`src/lib/ui/edge-privacy.test.ts`) |
| Staging (two merchant accounts) | **NOT RUN** |
| Production | **NOT RUN** |

`src/lib/ui/edge-authz.ts` holds the authorization rules as pure functions so
they can be tested at all: deny on no token, deny on unverified email, deny on
no owned stores, `storeFilter()` returning **null** rather than an empty string
for an unauthorized caller (so a query cannot silently become unfiltered), an
`assertScoped()` backstop, and an `auditOutput()` walker that fails if any
result carries `embedding`, `feature_vector`, `address` or `refusal_reason`.

The edge function keeps its own copy of these rules because Deno and the
browser bundle cannot share a module. **`deno check` passing does not prove the
authorization logic is correct** - it proves the file is well-typed. The
behavioural proof still requires staging with two merchant accounts.

### Remaining code debt (not blocking, but real)

- **36 `: any` parameter annotations remain** in the edge function - mostly
  `supabase: any, args: any` on the tool functions. They should become `Db`,
  `Record<string, unknown>` and typed RPC row shapes. `as any` is gone (0);
  parameter annotations are the next pass. This is why `deno check` passing is
  weaker evidence than it looks: `any` parameters suppress checking inside every
  tool body.
- `toolTopBuyers()` deliberately does **not** require an owned store, because it
  returns only masked aggregates. That is intentional, not an oversight.


---

## 5.1 Earlier plan text (superseded, kept for the record)

**Do not run the migration on its own.** It revokes `find_similar_buyers`,
which the **currently deployed** front end still calls, and the edge function
still calls with the service role.

### Step 1 - Deploy the frontend first

Safe under the current permissive policy, because the new RPCs are new and
`buyer_network_lookup` works regardless. This immediately stops fingerprints
reaching browsers via paths 2 and 5.

Sanity check after deploy: Buyer Lookup, New Order live preview, Similar
buyers, Buyer Map, Chat mentions, Settings export.

### Step 2 - Fix and deploy the edge function (path 6) - BLOCKED ON YOUR DECISION

`toolSimilarBuyers` must call `similar_buyers_by_phone` and stop returning
phone numbers, and the order tools need store scoping plus caller
verification. **I have not written this yet**, because it changes what Ask
Verafo can answer and that is a product decision: see section 8.

### Step 3 - Run the migration

Only after steps 1 and 2. Open the Supabase SQL Editor for the Verafo project,
paste `supabase/buyer-privacy-migration.sql`, and run it. Expect
"Success. No rows returned". If it raises
`Privacy migration failed: buyers still has an unrestricted SELECT policy`,
the fix did not apply - investigate before proceeding.

### Step 4 - Production verification

See section 7.

### Rollback

The migration file carries a tested rollback block. Reverting the frontend is
a Vercel redeploy of the previous deployment.

---

## 6. Dependencies

- `supabase/rls-production.sql` must already have been run: the migration uses
  `verafo_is_admin()` and `verafo_my_store_ids()`.
- Supabase URL + publishable key on the Vercel project **verafo**.
- Edge function `verafo-ai` for AI explanations and embeddings.
- No new environment variables are required by anything built so far.

---

## 7. Launch checks

**Manual, and only you can do them. Nothing here has been rendered or clicked.**

Highest risk first:

1. As a **non-admin merchant**, run the buyer export. The file must contain
   **only buyers who ordered from your store**. With no store selected you must
   get the refusal message and **no file**.
2. As a non-admin, type 3 digits into a chat mention field. **Nothing should be
   suggested.** A full number should still work.
3. Look up a number that has **never** ordered from you. You must still get a
   verdict, and **no other buyer's phone number** may appear on the page.
4. In devtools Network, look up a buyer. The responses must contain **no
   `embedding` and no `feature_vector`**.
5. After the migration, a cross-store `buyers` query must return **an empty
   array**, not other merchants' rows.
6. The settings export as an **admin** must still return the network.
7. Decide Queue: record "Ship anyway", then check Supabase - the order's
   `outcomes` status must **still be pending**.
8. Historical scan and what-if simulator on a store with real history.
   Counts must match the Orders page.
9. 375px width on Dashboard, Decide, Scan, Simulate: no sideways scroll,
   44px targets.
10. Dark mode and reduced motion.

---

## 8. Open decisions for you

1. **Edge function scope - ANSWERED.** R1 and R2 settled it: cross-store
   *aggregate* intelligence is a product feature, and private order data is
   restricted to the caller's own stores. The edge function is scoped
   accordingly, `toolTopBuyers` returns masked labels only, and partial-phone
   search is refused.
2. **Front-end-first release - SUPERSEDED.** It is not safe. The updated
   frontend calls SQL functions that do not exist in production, so Stage A
   must go first. See section 5.0.
3. **NEW, still open: what should a merchant see for a buyer who has never
   ordered from them?** The current answer is: the buyer's **network-wide
   aggregate** row (risk score, total orders, accepted, refused) plus **zero
   order detail**, because order rows are filtered to owned stores. That
   matches R3 as written. Confirm that this is the intended experience before
   launch.

---

## 9. Remaining work, realistically estimated

| Feature | State |
|---|---|
| Dashboard analytics and insight cards | **Implemented, code-verified** |
| Decide Queue | **Implemented**; needs `order-decisions-migration.sql` run |
| Historical scan | **Implemented, code-verified** |
| What-if simulator | **Implemented, code-verified** |
| Buyer privacy remediation | **Code complete and type-checked; migrations unapplied, nothing deployed** |
| Lookalike Audiences page | **Not built** (logic and 28 tests exist) |
| Buyer Passport page | **Not built** (logic and tests exist) |
| City / courier intelligence | **Not built.** No courier data exists in the schema at all - this needs a new integration, not just code |
| Ask Verafo upgrades | **Unblocked** - scoping decided and implemented; deploy with Stage A |
| WhatsApp alerts | **Not started.** Needs provider credentials; none are configured |
| Weekly reports | **Not started** |
| ROI and proof of value | **Not started.** No plan or cost data is stored anywhere |

Rough sizes, single engineer: Audiences and Passport **2-3 days**. City
intelligence **1-2 days** (courier needs a separate data-source project).
Weekly reports **2 days**. ROI **1-2 days** after a decision on where plan cost
lives. WhatsApp alerts **2-3 days** plus provider setup.

---

## 10. Exact next action required from you

Everything that can be done without touching production is **done**, and
verified:

```
deno check --node-modules-dir=auto supabase/functions/verafo-ai/index.ts   -> exit 0
npm test                                                                   -> 261 passed / 261
npx tsc -b                                                                 -> exit 0
npm run build                                                              -> exit 0
```

What remains is entirely **production access**, which is yours to grant:

1. **Apply Stage A** in the Supabase SQL Editor, in this order:
   `supabase/buyer-privacy-stage-a.sql`, then
   `supabase/aggregate-stats-migration.sql`. Both are additive and safe alone.
   Then confirm the five-function check in section 5, Step 1 returns five rows.
2. **Deploy the frontend, then the edge function.**
3. **Apply Stage C** (`supabase/buyer-privacy-stage-c.sql`) only after step 2
   is verified.
4. **Run the seven highest-risk checks in section 7** and report what you see.
5. **Answer open decision 3** (what a merchant should see for a buyer who has
   never ordered from them).

Until steps 1-3 are done, **the cross-merchant exposure remains live in
production.** No code change can close it, because the leak is the
`buyers read ... using (true)` RLS policy that Stage C replaces.
