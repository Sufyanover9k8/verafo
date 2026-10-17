# Your tasks

Everything below is work only you can do — it needs your Supabase login, your
GitHub credentials, or the Shopify partner account. Nothing here has been run
by me. Estimated total: about 25 minutes.

---

## 1. Run the SQL files on Supabase (about 10 min)

Supabase dashboard → your project (`verafo` / `gvjbolyoeisyjsphnwze`) →
**SQL Editor** → **New query**. For each file: open it in the repo, copy the
whole thing, paste, press **Run**. Every file is idempotent, so re-running one
is safe.

Run them **in this order**.

| # | File | Why it matters |
|---|------|----------------|
| 1 | `supabase/chat-privacy.sql` | 🔴 **Do this one first.** Today every signed-in merchant can read every other merchant's Ask Verafo chats through the API. This closes it. |
| 2 | `supabase/notifications.sql` | Adds the notifications table, the admin broadcast function, the daily digest and the outcome trigger. **The bell in the top bar is empty until this runs.** |
| 3 | `supabase/order-soft-delete.sql` | Adds **Delete** to the Orders page as a *hide*: the order leaves every screen but is never removed from the database, because the order history is what the risk model learns from. Until this runs, the Delete control simply does not appear. |
| 4 | `supabase/lookup-fingerprint-flag.sql` | Makes the "no fingerprint" flag in Buyer Lookup truthful. |
| 5 | `supabase/shopify-risk-neutral.sql` | Lets Shopify-created orders start as *no data* instead of guessing a risk band. |
| 6 | `supabase/shopify-store-claim.sql` | Lets a merchant claim the store the Shopify app created for them. |

After each one, the editor should say **Success. No rows returned**. An error
that mentions a missing function or column means an earlier file was skipped —
run 1–6 in order and tell me the exact message if anything still fails.

**If a file errors, nothing in it was applied.** The SQL editor runs a script as
one transaction, so a failure at statement 40 rolls back statements 1–39 as well.
You do not have to clean up a half-run file — fix it and run the whole thing
again.

`order-soft-delete.sql` used to fail with
`42P13 cannot change return type of existing function ... store_overview()`.
That statement is gone: your deployed `store_overview()` returns two columns the
repo version does not, so replacing it would have quietly deleted them. If you
want the admin `/stores` counts to ignore hidden orders too, run this and send
me the output — I will patch the real definition instead of guessing:

```sql
select pg_get_functiondef('public.store_overview'::regproc);
```

**Check #1 worked** — paste this and run it. You should get five rows whose
predicate mentions `verafo_current_email()`, and **no** row whose predicate is
just `true`. A row called `chats all` means the file did not run:

```sql
select tablename, policyname, cmd, coalesce(qual, with_check) as predicate
from pg_policies
where schemaname = 'public' and tablename in ('chats', 'chat_messages')
order by tablename, policyname;
```

**Check #2 worked** — paste this and run it. It should return one row per
store owner:

```sql
select count(*) from notifications;
```

**Check #3 worked** — this must return `false` (the column exists), and `0`
hidden orders until somebody deletes one:

```sql
select
  not exists (
    select 1 from information_schema.columns
     where table_name = 'orders' and column_name = 'deleted_at'
  ) as deleted_at_missing,
  count(*) filter (where deleted_at is not null) as hidden
from orders;
```

---

## 1b. What "Delete" means on the Orders page

Deleting an order does **not** delete it. It sets `orders.deleted_at`, which:

- removes it from Orders, Outcomes, Buyer Lookup, RTO Insights, the store
  dashboard and every headline number;
- keeps the row, its buyer and its outcome in Postgres, so the order history you
  train the model on is exactly as complete as before;
- can be undone at any time — **Hidden** in the top right of the Orders page
  lists every hidden order with a Restore button;
- does not change buyer risk scores: a refusal still teaches the model, it just
  stops being shown.

So there is no way for a merchant to shrink your training set by accident.

---

## 2. Turn on Google sign-in (about 10 min)

The **Continue with Google** button is on `/login` now, and it is dead until this
is done: your Supabase project has no Google provider configured yet (the auth
endpoint answers `validation_failed`). Email and password keep working in the
meantime.

**A. Google Cloud Console** → <https://console.cloud.google.com>

1. Create a project (or pick one), then **APIs & Services → OAuth consent screen**
   → type **External** → fill in app name `Verafo`, your support email and your
   developer email → **Save and continue** through the screens.
2. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   Application type **Web application**.
3. **Authorized JavaScript origins** — add both:
   - `https://www.verafo.com`
   - `https://verafo.com`
4. **Authorized redirect URIs** — add exactly this one:
   - `https://gvjbolyoeisyjsphnwze.supabase.co/auth/v1/callback`
5. **Create**, then copy the **Client ID** and **Client secret**.

**B. Supabase** → Authentication → **Providers** → **Google**

1. Turn **Enable Sign in with Google** on.
2. Paste the Client ID and Client secret → **Save**.
3. Authentication → **URL Configuration**:
   - **Site URL**: `https://www.verafo.com`
   - **Redirect URLs**: add `https://www.verafo.com/**` and, if you use it,
     `https://verafo.com/**`.

Then open `https://www.verafo.com/login` and click **Continue with Google**. It
creates the account on first use and signs in afterwards — one button for both,
because Google does not distinguish the two.

If the button reports *"Google sign-in is not switched on yet"*, step B did not
save — the message comes straight from the provider check.

---

## 3. Push the code (about 5 min)

The repo is `C:\Users\lavee\Desktop\Verafo\verafo-frontend` — **not**
`C:\Users\lavee\Desktop\verafo-frontend`. That mismatch is what broke the push
last time.

```powershell
cd C:\Users\lavee\Desktop\Verafo\verafo-frontend
git status
git add -A
git commit -m "Notifications bell, admin broadcast, outcomes search, mobile fixes"
git push cofounder release/redesign-privacy
```

If `git push` says `src refspec ... does not match any`, you are in the wrong
folder — re-run `cd` above.

---

## 4. Deploy the Shopify app (about 5 min)

`apps/shopify` has a fix that stops out-of-order webhook retries from
re-writing an order's outcome. It only goes live when you deploy it:

```powershell
cd C:\Users\lavee\Desktop\Verafo\verafo-frontend\apps\shopify
npm install
npx shopify app deploy
```

---

## 5. Test the new bell (about 5 min, after step 1.2)

First prove the table exists — this must return a number, not an error:

```sql
select count(*) from notifications;
```

If it says `relation "public.notifications" does not exist`, step 1.2 did not
run. Nothing else will work until it does.

1. Open **Outcomes** and mark any order accepted or refused.
2. Click the bell. The entry appears immediately — no reload needed.
3. In Supabase → SQL Editor, run this as a stand-in for a webhook:

   ```sql
   select verafo_send_notification('Test from Verafo', 'If you can read this, the bell works.', null, true, null);
   ```

   It returns the number of people it reached.
4. As an admin, open **Admin** in the sidebar (Operate section, below Stores),
   send yourself a notification, and confirm it appears in the bell and in
   "Recently sent".

**What creates a notification, exactly:**

- **every** logged outcome, including the ones you mark yourself — accepted,
  refused, a change of verdict, and each row of a bulk action. The entry is
  `Order refused` / `Order accepted` with the buyer's phone and the product, plus
  `by <email>` when somebody other than the store owner did it;
- the daily report, once per day per user, on first load;
- anything the Verafo team sends from **Admin**.

Clearing a verdict back to *no outcome* deliberately writes nothing: there is no
outcome to report.

---

## Still open on my side (not yours)

- Duplicate-buyer cleanup: the same phone can appear twice under different
  spellings (`+92…`, `0…`, bare 10 digits). Only a read-only report exists so
  far, nothing destructive.
- Orders table on a phone still uses the desktop table for the expanded rows.
