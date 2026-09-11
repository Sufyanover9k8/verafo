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
--   * the risk-score pipeline (recompute_buyer + its two triggers) runs as
--     SECURITY DEFINER, so logging an order through the web app (not just
--     Shopify) still updates buyer scores once buyers has real RLS on it.
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

-- 2b. Make the risk-score pipeline immune to RLS ---------------------------
-- recompute_buyer() / on_order_change() / on_outcome_change() write to
-- `buyers` from a trigger on `orders`/`outcomes`. Postgres runs a plain
-- (non-definer) function's trigger with the privileges of whoever caused the
-- trigger to fire — for the Shopify app that's the service role (fine,
-- bypasses RLS anyway), but for a merchant logging an order from the web UI
-- (New Order / Bulk Import) that's their own `authenticated` session. Without
-- this, the very first RLS-protected UPDATE on `buyers` below would be
-- silently blocked and every order logged through the app would stop
-- updating risk scores. Marking these SECURITY DEFINER makes the score
-- pipeline run as the function owner regardless of who fired the trigger —
-- and, as a side effect, means `buyers` needs no direct UPDATE grant for
-- authenticated users at all (see 7. below): nobody can rewrite a risk score
-- by hand, only the trigger can.
create or replace function recompute_buyer(p_phone text)
returns buyers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b buyers%rowtype;
  v_orders int;
  v_accepted int;
  v_refused int;
  v_rate numeric;
  v_score numeric;
  v_boost numeric := 0;
  v_new_address boolean := false;
  v_first_today boolean := false;
begin
  select
    count(*),
    count(*) filter (where ou.status = 'accepted'),
    count(*) filter (where ou.status = 'refused')
  into v_orders, v_accepted, v_refused
  from orders o
  join outcomes ou on ou.order_id = o.id
  where o.buyer_phone = p_phone
    and ou.status <> 'pending';

  if v_orders = 0 then
    v_score := 0.5;
  else
    v_rate := v_refused::numeric / v_orders;
    if v_orders < 3 then
      v_score := 0.5 + (v_rate - 0.5) * (v_orders / 3.0);
    else
      v_score := v_rate;
    end if;
  end if;

  select exists (
    select 1
    from orders o
    where o.buyer_phone = p_phone
      and o.address is not null
      and o.address = (
        select o2.address from orders o2
        where o2.buyer_phone = p_phone order by o2.ordered_at desc limit 1
      )
    group by o.address
    having count(*) = 1
  )
  into v_new_address;
  if v_new_address then
    v_boost := v_boost + 0.05;
  end if;

  select exists (
    select 1 from buyers where phone = p_phone and first_seen::date = current_date
  )
  into v_first_today;
  if v_first_today then
    v_boost := v_boost + 0.05;
  end if;

  if v_accepted >= 5 and (
    select count(distinct store_id) from orders where buyer_phone = p_phone
  ) >= 2 then
    v_boost := v_boost - 0.2;
  end if;

  v_score := v_score + v_boost;
  v_score := greatest(0.0, least(1.0, v_score));

  update buyers
  set total_orders = v_orders,
      total_accepted = v_accepted,
      total_refused = v_refused,
      risk_score = v_score,
      updated_at = now()
  where phone = p_phone
  returning * into b;

  return b;
end;
$$;

create or replace function on_order_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform recompute_buyer(new.buyer_phone);
  return new;
end;
$$;

create or replace function on_outcome_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text;
begin
  select buyer_phone into v_phone from orders where id = coalesce(new.order_id, old.order_id);
  if v_phone is not null then
    perform recompute_buyer(v_phone);
  end if;
  return coalesce(new, old);
end;
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

-- 7. BUYERS — the shared signal. Any signed-in user may read.
drop policy if exists "buyers read" on buyers;
create policy "buyers read" on buyers for select to authenticated using (true);
-- NOTE: `embedding` / `feature_vector` are still selectable here (Lookup.tsx
-- currently needs `embedding` client-side to call find_similar_buyers()).
-- Follow-up: add a phone-based, server-side similarity RPC and stop sending
-- the raw vector to the browser at all.

-- New Order / Bulk Import create a bare `{phone}` stub row before the order
-- exists (so the orders.buyer_phone FK has something to point at) — allow
-- that, but only as a neutral stub: nobody can INSERT a buyer pre-loaded with
-- a spoofed trust history. The real numbers only ever come from the
-- SECURITY DEFINER trigger pipeline above.
drop policy if exists "buyers insert stub" on buyers;
create policy "buyers insert stub" on buyers for insert to authenticated
  with check (
    coalesce(risk_score, 0.5) = 0.5
    and coalesce(total_orders, 0) = 0
    and coalesce(total_accepted, 0) = 0
    and coalesce(total_refused, 0) = 0
  );
-- Deliberately no "buyers update" policy for authenticated: risk_score/
-- total_* are only ever written by the SECURITY DEFINER recompute pipeline
-- above, which runs as the function owner and so isn't subject to this
-- table's RLS at all. This closes off any direct REST call a signed-in user
-- could otherwise make to hand-edit a buyer's score.

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
grant select, insert on buyers to authenticated;
-- No `update` grant here on purpose — see the "buyers insert stub" policy
-- above. The score pipeline (SECURITY DEFINER) doesn't need it either.
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
-- drop policy if exists "buyers read" on buyers;    drop policy if exists "buyers insert stub" on buyers;
-- drop policy if exists "lookups all" on lookups;
-- drop policy if exists "chats all" on chats;       drop policy if exists "chat_messages all" on chat_messages;
-- Note: this rollback does not un-mark recompute_buyer/on_order_change/
-- on_outcome_change as SECURITY DEFINER — that's safe to leave either way,
-- since it only changes *whose privileges* the trigger runs with, not RLS
-- policies themselves, and the demo-anon policies below don't touch buyers.
-- create policy "demo anon stores" on stores for all to anon using (true) with check (true);
-- create policy "demo anon buyers" on buyers for all to anon using (true) with check (true);
-- create policy "demo anon orders" on orders for all to anon using (true) with check (true);
-- create policy "demo anon outcomes" on outcomes for all to anon using (true) with check (true);
-- create policy "demo anon lookups" on lookups for all to anon using (true) with check (true);
-- create policy "demo anon chats" on chats for all to anon using (true) with check (true);
-- create policy "demo anon chat_messages" on chat_messages for all to anon using (true) with check (true);
