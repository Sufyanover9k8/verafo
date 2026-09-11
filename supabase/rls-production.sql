-- ============================================================================
-- Verafo — production Row-Level Security
-- ----------------------------------------------------------------------------
-- Replaces the "demo anon can do everything" policies from schema.sql with
-- authenticated, per-merchant policies:
--
--   * admins (a row in verafo_admins) see and manage every store's data
--   * a merchant sees only rows for stores where stores.owner_email is their
--     signed-in email
--   * every signed-in user can read the buyers table — that IS the shared
--     risk signal / cross-store lookup (the product). Order-level data never
--     crosses between merchants.
--
-- The Shopify app + edge functions use the SERVICE ROLE key, which bypasses
-- RLS entirely, so this does NOT affect the Shopify integration.
--
-- ⚠️ RUN ORDER (see DEPLOY.md):
--   1. Deploy the new frontend build (the one with login) + set its
--      VITE_SUPABASE_* / VITE_ADMIN_EMAILS env on Vercel.
--   2. INSERT your team's emails into verafo_admins (below).
--   3. Only then run the rest of this file. Un-logged-in / anon traffic will
--      get nothing after this — which is fine, the app now requires login.
--
-- Rollback: re-run the "demo anon" block at the bottom of this file.
-- ============================================================================

-- 1. Admin registry ---------------------------------------------------------
create table if not exists verafo_admins (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table verafo_admins enable row level security;
-- readable by any signed-in user (so the app can check its own role), writable
-- only via the service role / SQL editor.
drop policy if exists "admins readable" on verafo_admins;
create policy "admins readable" on verafo_admins for select to authenticated using (true);

-- >>> EDIT THIS: your Verafo team emails <<<
insert into verafo_admins (email) values
  ('you@verafo.example')
on conflict (email) do nothing;

-- 2. Helpers --------------------------------------------------------------
create or replace function verafo_current_email()
returns text language sql stable as $$
  select nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '')
$$;

create or replace function verafo_is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from verafo_admins a where a.email = verafo_current_email()
  )
$$;

create or replace function verafo_my_store_ids()
returns setof uuid language sql stable as $$
  select id from stores where lower(coalesce(owner_email, '')) = verafo_current_email()
$$;

-- 3. Drop the demo-anon policies ---------------------------------------------
drop policy if exists "demo anon stores" on stores;
drop policy if exists "demo anon buyers" on buyers;
drop policy if exists "demo anon orders" on orders;
drop policy if exists "demo anon outcomes" on outcomes;
drop policy if exists "demo anon lookups" on lookups;
drop policy if exists "demo anon chats" on chats;
drop policy if exists "demo anon chat_messages" on chat_messages;

-- 4. STORES ---------------------------------------------------------------
drop policy if exists "stores read" on stores;
create policy "stores read" on stores for select to authenticated
  using (verafo_is_admin() or lower(coalesce(owner_email, '')) = verafo_current_email());

drop policy if exists "stores insert" on stores;
create policy "stores insert" on stores for insert to authenticated
  with check (verafo_is_admin() or lower(coalesce(owner_email, '')) = verafo_current_email());

drop policy if exists "stores update" on stores;
create policy "stores update" on stores for update to authenticated
  using (verafo_is_admin() or lower(coalesce(owner_email, '')) = verafo_current_email())
  with check (verafo_is_admin() or lower(coalesce(owner_email, '')) = verafo_current_email());

drop policy if exists "stores delete" on stores;
create policy "stores delete" on stores for delete to authenticated
  using (verafo_is_admin());

-- 5. ORDERS -------------------------------------------------------------
drop policy if exists "orders read" on orders;
create policy "orders read" on orders for select to authenticated
  using (verafo_is_admin() or store_id in (select verafo_my_store_ids()));

drop policy if exists "orders insert" on orders;
create policy "orders insert" on orders for insert to authenticated
  with check (verafo_is_admin() or store_id in (select verafo_my_store_ids()));

drop policy if exists "orders update" on orders;
create policy "orders update" on orders for update to authenticated
  using (verafo_is_admin() or store_id in (select verafo_my_store_ids()));

-- 6. OUTCOMES ---------------------------------------------------------------
drop policy if exists "outcomes read" on outcomes;
create policy "outcomes read" on outcomes for select to authenticated
  using (
    verafo_is_admin()
    or order_id in (select id from orders where store_id in (select verafo_my_store_ids()))
  );

drop policy if exists "outcomes write" on outcomes;
create policy "outcomes write" on outcomes for all to authenticated
  using (
    verafo_is_admin()
    or order_id in (select id from orders where store_id in (select verafo_my_store_ids()))
  )
  with check (
    verafo_is_admin()
    or order_id in (select id from orders where store_id in (select verafo_my_store_ids()))
  );

-- 7. BUYERS — the shared signal. Any signed-in user may read; nobody but the
--    service role may write (scores are computed by triggers / edge functions).
drop policy if exists "buyers read" on buyers;
create policy "buyers read" on buyers for select to authenticated using (true);
-- NOTE: `embedding` / `feature_vector` are still selectable here. Follow-up:
-- expose a `buyer_signal` view without those columns and point Lookup at it.

-- 8. LOOKUPS — recent-lookups history. Permissive for now (no owner column).
drop policy if exists "lookups all" on lookups;
create policy "lookups all" on lookups for all to authenticated using (true) with check (true);

-- 9. CHATS / CHAT_MESSAGES — no owner column yet. Permissive for now.
--    Follow-up: add chats.owner_email and scope per user.
drop policy if exists "chats all" on chats;
create policy "chats all" on chats for all to authenticated using (true) with check (true);
drop policy if exists "chat_messages all" on chat_messages;
create policy "chat_messages all" on chat_messages for all to authenticated using (true) with check (true);

-- 10. Grants --------------------------------------------------------------
grant usage on schema public to authenticated;
grant select on verafo_admins to authenticated;
grant select, insert, update on stores to authenticated;
grant select, insert, update on orders to authenticated;
grant select, insert, update, delete on outcomes to authenticated;
grant select on buyers to authenticated;
grant select, insert, delete on lookups to authenticated;
grant select, insert, update, delete on chats to authenticated;
grant select, insert, delete on chat_messages to authenticated;
grant execute on function verafo_is_admin() to authenticated;
grant execute on function verafo_my_store_ids() to authenticated;
grant execute on function verafo_current_email() to authenticated;

-- ============================================================================
-- ROLLBACK — paste this to restore the open demo behaviour
-- ============================================================================
-- drop policy if exists "stores read" on stores;  drop policy if exists "stores insert" on stores;
-- drop policy if exists "stores update" on stores; drop policy if exists "stores delete" on stores;
-- drop policy if exists "orders read" on orders;   drop policy if exists "orders insert" on orders;
-- drop policy if exists "orders update" on orders;
-- drop policy if exists "outcomes read" on outcomes; drop policy if exists "outcomes write" on outcomes;
-- drop policy if exists "buyers read" on buyers;    drop policy if exists "lookups all" on lookups;
-- drop policy if exists "chats all" on chats;       drop policy if exists "chat_messages all" on chat_messages;
-- create policy "demo anon stores" on stores for all to anon using (true) with check (true);
-- create policy "demo anon buyers" on buyers for all to anon using (true) with check (true);
-- create policy "demo anon orders" on orders for all to anon using (true) with check (true);
-- create policy "demo anon outcomes" on outcomes for all to anon using (true) with check (true);
-- create policy "demo anon lookups" on lookups for all to anon using (true) with check (true);
-- create policy "demo anon chats" on chats for all to anon using (true) with check (true);
-- create policy "demo anon chat_messages" on chat_messages for all to anon using (true) with check (true);
