-- ============================================================
-- Verafo — PRIVACY STAGE C: close the exposure
--   [PRODUCTION INCIDENT FIX — PART 2 OF 2]
--
-- ONLY RUN THIS AFTER BOTH OF THESE ARE TRUE:
--   1. Stage A (buyer-privacy-stage-a.sql) has been applied, so
--      buyer_network_lookup and similar_buyers_by_phone exist.
--   2. The updated FRONTEND and EDGE FUNCTION are deployed, so nothing
--      still calls find_similar_buyers or reads buyers.* directly.
--
-- Applying this early WILL break Buyer Lookup, the New Order preview and
-- Ask Verafo for live merchants.
--
-- WHAT THIS STAGE DOES (and it all runs in ONE transaction: any failure,
-- including a failed self-check, rolls the whole file back)
--   1. buyers: drops every open policy by name, keeps a single owner-scoped
--      SELECT plus a neutral-stub INSERT (see the note below), revokes
--      anon entirely.
--   2. chats / chat_messages: owner-only, keyed on chats.created_by.
--   3. verafo_admins: no broad read; verafo_is_admin() becomes SECURITY
--      DEFINER so dropping the broad policy cannot break it.
--   4. find_similar_buyers: revoked for EVERY overload from public, anon
--      and authenticated, with a self-check that fails loudly.
--   5. The scoring pipeline (recompute_buyer + its triggers) is re-asserted
--      as SECURITY DEFINER and loses its public EXECUTE grant: it is the one
--      thing that may write buyers once authenticated UPDATE is gone.
--   6. verafo_config: revoked from anon/authenticated + row level security
--      (no code in this repo reads or writes it).
--   7. Self-checks on buyers and on the revoked functions.
--
-- DEPENDENCY: supabase/rls-production.sql (for verafo_is_admin,
-- verafo_current_email and verafo_my_store_ids), supabase/schema.sql or
-- supabase/features-migration.sql (recompute_buyer and its triggers) and
-- buyer-privacy-stage-a.sql (verafo_normalize_phone).
--
-- Rollback is at the bottom.
-- ============================================================

begin;

-- ── 0. Preconditions ────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.verafo_is_admin()') is null
     or to_regprocedure('public.verafo_current_email()') is null
     or to_regprocedure('public.verafo_my_store_ids()') is null then
    raise exception 'Stage C needs supabase/rls-production.sql first: verafo_is_admin() / verafo_current_email() / verafo_my_store_ids() are missing.';
  end if;
  if to_regprocedure('public.verafo_normalize_phone(text)') is null then
    raise exception 'Stage C needs supabase/buyer-privacy-stage-a.sql first: verafo_normalize_phone(text) is missing.';
  end if;
  if to_regprocedure('public.recompute_buyer(text)') is null then
    raise exception 'Stage C needs supabase/features-migration.sql (or schema.sql) first: recompute_buyer(text) is missing.';
  end if;
  -- The neutral-stub INSERT policy below asserts on both vector columns.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'buyers' and column_name = 'feature_vector'
  ) then
    raise exception 'Stage C needs supabase/features-migration.sql first: buyers.feature_vector is missing.';
  end if;
end $$;

-- ── 1. verafo_admins: no broad read ─────────────────────────
-- The only reader of this table is verafo_is_admin(), which used to run with
-- the caller's privileges — that is WHY the table needed a
-- "readable by any signed-in user" policy. Making it SECURITY DEFINER lets
-- the broad policy go without breaking a single admin check.
alter table verafo_admins enable row level security;

create or replace function verafo_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from verafo_admins a where a.email = verafo_current_email()
  )
$$;

-- No website code reads this table (the browser uses VITE_ADMIN_EMAILS), so
-- the broad policy is dropped rather than replaced. A signed-in admin may
-- still read their OWN row, which is all an "am I an admin?" check needs.
drop policy if exists "admins readable" on verafo_admins;
drop policy if exists "admins read own row" on verafo_admins;
create policy "admins read own row" on verafo_admins for select to authenticated
  using (email = verafo_current_email());

revoke all on verafo_admins from anon;
grant select on verafo_admins to authenticated;

-- ── 2. buyers: one owner-scoped read, no open write ─────────
alter table buyers enable row level security;

-- Every open policy named in the incident report, plus the two this file
-- creates (so the file can be re-run).
drop policy if exists "authenticated read buyers" on buyers;
drop policy if exists "authenticated write buyers" on buyers;
drop policy if exists "authenticated update buyers" on buyers;
drop policy if exists "buyers read" on buyers;
drop policy if exists "buyers insert stub" on buyers;
drop policy if exists "demo anon buyers" on buyers;
drop policy if exists "buyers read own" on buyers;
drop policy if exists "buyers insert neutral stub" on buyers;

-- Before: any signed-in user, every row, every column, including embedding
-- and feature_vector.
-- After:  the buyer has an order in one of MY stores, or I am an admin.
create policy "buyers read own" on buyers for select to authenticated
  using (
    verafo_is_admin()
    or exists (
      select 1
      from orders o
      where o.buyer_phone = buyers.phone
        and o.store_id in (select verafo_my_store_ids())
    )
  );

-- INSERT — kept, but only as a neutral stub, because real code depends on it:
--   · src/pages/NewOrder.tsx  upserts { phone } before the order exists
--   · src/pages/BulkImport.tsx does the same for each imported line
--   · orders.buyer_phone -> buyers(phone) is a foreign key, so the order
--     cannot be inserted without the stub row.
-- Dropping buyers INSERT entirely would break "log an order" for every
-- merchant. This is NOT the old open policy: the row must be a neutral stub
-- (no spoofed trust history) AND a complete Pakistani number. Nothing here
-- lets a merchant read the row back — `buyers read own` only shows buyers who
-- already ordered from their own stores.
--
-- REVIEW NOTE (A1): both callers use
-- `upsert({ phone }, { onConflict: 'phone', ignoreDuplicates: true })`, which
-- is INSERT … ON CONFLICT DO NOTHING — there is no UPDATE path, so a merchant
-- can never rewrite an existing buyer through this policy. WITH CHECK is
-- evaluated on the row being PROPOSED (a bare {phone}, so all the neutral
-- tests pass) and the conflict then does nothing. A repeat order for a known
-- buyer therefore still works; the runbook has a two-order check for it.
create policy "buyers insert neutral stub" on buyers for insert to authenticated
  with check (
    coalesce(risk_score, 0.5) = 0.5
    and coalesce(total_orders, 0) = 0
    and coalesce(total_accepted, 0) = 0
    and coalesce(total_refused, 0) = 0
    and embedding is null
    and feature_vector is null
    and verafo_normalize_phone(phone) is not null
  );

-- Deliberately NO update and NO delete policy: risk_score / total_* are only
-- ever written by the SECURITY DEFINER pipeline in section 5 below.
revoke all on buyers from anon;
revoke update, delete, truncate, references, trigger on buyers from authenticated;
grant select, insert on buyers to authenticated;

-- ── 3. chats / chat_messages: owner only ────────────────────
-- The browser inserts a chat with only { title } (src/pages/Chat.tsx), so the
-- owner column needs a default or every new chat would be ownerless. The
-- default is auth.uid(): the client never sends created_by, and a client that
-- tried to send someone else's id would be rejected by the policy below.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chats' and column_name = 'created_by'
  ) then
    alter table chats add column created_by uuid;
    raise notice 'chats.created_by added: EXISTING rows stay NULL and become invisible until they are attributed by hand (see the note at the bottom of this file).';
  end if;
  alter table chats alter column created_by set default auth.uid();
end $$;

alter table chats enable row level security;
alter table chat_messages enable row level security;

drop policy if exists "chats all" on chats;
drop policy if exists "demo anon chats" on chats;
drop policy if exists "user owns their chats" on chats;
create policy "user owns their chats" on chats for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- chat_messages: only messages that belong to a chat the user owns. The
-- subquery is itself filtered by the chats policy above, which is the same
-- condition, so it cannot widen access.
drop policy if exists "chat_messages all" on chat_messages;
drop policy if exists "demo anon chat_messages" on chat_messages;
drop policy if exists "chat_messages own" on chat_messages;
create policy "chat_messages own" on chat_messages for all to authenticated
  using (
    exists (
      select 1 from chats c
      where c.id = chat_messages.chat_id
        and c.created_by = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from chats c
      where c.id = chat_messages.chat_id
        and c.created_by = auth.uid()
    )
  );

revoke all on chats from anon;
revoke all on chat_messages from anon;
grant select, insert, update, delete on chats to authenticated;
grant select, insert, update, delete on chat_messages to authenticated;

-- ── 4. The legacy bulk reader ───────────────────────────────
-- find_similar_buyers returns phone numbers and took a raw embedding from the
-- browser. It is revoked on EVERY overload, whatever its argument list.
do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'find_similar_buyers'
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      r.nspname, r.proname, r.args
    );
    v_count := v_count + 1;
  end loop;
  raise notice 'find_similar_buyers: revoked on % overload(s).', v_count;
end $$;

-- ── 5. The scoring pipeline must survive this ───────────────
-- recompute_buyer() and its triggers write `buyers` from a trigger on
-- `orders` / `outcomes`. Once authenticated has no UPDATE policy or grant on
-- buyers, an INVOKER trigger would be silently blocked and every order logged
-- through the web app would stop updating risk scores. These functions are
-- re-asserted as SECURITY DEFINER here (attributes only — the scoring formula
-- is never touched), and their EXECUTE grant is removed: recompute_buyer
-- returns a whole `buyers` row, embedding included.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('recompute_buyer', 'on_order_change', 'on_outcome_change')
  loop
    execute format('alter function %I.%I(%s) security definer', r.nspname, r.proname, r.args);
    execute format('alter function %I.%I(%s) set search_path to public, pg_temp', r.nspname, r.proname, r.args);
    execute format('revoke all on function %I.%I(%s) from public, anon, authenticated', r.nspname, r.proname, r.args);
  end loop;
end $$;

-- ── 6. verafo_config ────────────────────────────────────────
-- Step-1 finding: NOTHING in this repo (browser, edge function, Shopify app,
-- SQL) reads or writes verafo_config. It was readable by the public key, and
-- its contents are unknown. So: row level security on, no grants to anon or
-- authenticated. The service role and the SQL editor still work.
-- If some external tool uses the anon key to read it, this is the statement
-- that breaks it: re-grant the single column that tool needs instead of
-- reopening the table.
do $$
begin
  if to_regclass('public.verafo_config') is null then
    raise notice 'verafo_config does not exist in this database: nothing to lock down.';
  else
    execute 'alter table public.verafo_config enable row level security';
    execute 'revoke all on table public.verafo_config from public, anon, authenticated';
  end if;
end $$;

-- ── 7. The public (anon) surface ────────────────────────────
-- Review of every EXECUTE grant in this repo. Each of these functions is
-- reachable with the public (anon) key today, and NOTHING in the product calls
-- any of them that way: the app only renders its RPC callers after sign-in
-- (src/App.tsx returns the login screen when there is no session), and the
-- Shopify app calls upsert_store_for_shop with the service role. So anon loses
-- all of them here. The four the dashboard uses keep the `authenticated` grant
-- they already have.
--
-- Supabase also installs DEFAULT PRIVILEGES that grant EXECUTE on every new
-- function in `public` to anon and authenticated, so each role is revoked
-- explicitly instead of relying on a revoke from PUBLIC.
do $$
declare
  v_sigs text[] := array[
    'network_kpis()',
    'search_stores(text, int)',
    'store_overview()',
    'daily_sales(uuid, int)',
    'verafo_is_admin()',
    'verafo_my_store_ids()',
    'verafo_current_email()'
  ];
  v_sig text;
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure('public.' || v_sig) is null then
      raise notice 'anon revoke: public.% is not present in this database, skipping.', v_sig;
      continue;
    end if;
    execute format('revoke all on function public.%s from public, anon', v_sig);
  end loop;
end $$;

-- upsert_store_for_shop is SECURITY DEFINER and WRITES a store row (name =
-- domain), so it is server-only. A signed-in user may not call it either.
do $$
begin
  if to_regprocedure('public.upsert_store_for_shop(text)') is null then
    raise notice 'anon revoke: public.upsert_store_for_shop(text) is not present in this database, skipping.';
  else
    execute 'revoke all on function public.upsert_store_for_shop(text) from public, anon, authenticated';
  end if;
end $$;

-- ── 8. Self-checks (any failure rolls the whole file back) ──
-- 8a. buyers: no permissive policy other than the two this file created.
do $$
declare
  v_left int;
  v_expected text[] := array['buyers read own', 'buyers insert neutral stub'];
begin
  select count(*) into v_left
  from pg_policies
  where schemaname = 'public'
    and tablename = 'buyers'
    and permissive = 'PERMISSIVE'
    and cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL')
    and policyname <> all (v_expected);

  if v_left > 0 then
    raise exception 'Stage C failed: buyers still carries % permissive policy row(s) that this migration did not create.', v_left
      using hint = 'select policyname, cmd, qual, with_check from pg_policies where schemaname = ''public'' and tablename = ''buyers''; drop the extras, then re-run this file.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'buyers'
      and policyname = 'buyers read own' and cmd = 'SELECT'
  ) then
    raise exception 'Stage C failed: the "buyers read own" SELECT policy is missing.';
  end if;
end $$;

-- 8b. No open SELECT policy left on buyers at all (the original check).
do $$
declare
  n int;
begin
  select count(*) into n
  from pg_policies
  where schemaname = 'public'
    and tablename = 'buyers'
    and cmd = 'SELECT'
    and coalesce(qual, '') in ('true', '(true)');

  if n > 0 then
    raise exception 'Stage C failed: buyers still has an unrestricted SELECT policy.';
  end if;
end $$;

-- 8c. find_similar_buyers is not executable by anon or authenticated.
-- (Assumes the Supabase roles anon/authenticated exist, which they do on any
-- hosted Supabase project.)
do $$
declare
  n int;
begin
  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname = 'find_similar_buyers'
    and (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

  if n > 0 then
    raise exception 'Stage C failed: find_similar_buyers is still executable by anon or authenticated (% overload(s)).', n;
  end if;
end $$;

-- 8d. The scoring pipeline that writes buyers is SECURITY DEFINER.
do $$
declare
  n int;
begin
  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in ('recompute_buyer', 'on_order_change', 'on_outcome_change')
    and not p.prosecdef;

  if n > 0 then
    raise exception 'Stage C failed: % function(s) that write buyers are not SECURITY DEFINER, so logging an order would silently stop updating risk scores.', n;
  end if;
end $$;

-- 8e. The public (anon) surface from section 7 is closed.
do $$
declare
  v_sigs text[] := array[
    'network_kpis()',
    'search_stores(text, int)',
    'store_overview()',
    'daily_sales(uuid, int)',
    'upsert_store_for_shop(text)',
    'verafo_is_admin()',
    'verafo_my_store_ids()',
    'verafo_current_email()',
    'verafo_aggregate_stats(text, int)',
    'verafo_buyer_ranking(uuid[], text, int, int)',
    'buyer_network_lookup(text)',
    'similar_buyers_by_phone(text, int)',
    'recompute_buyer(text)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure('public.' || v_sig) is null then
      continue;
    end if;
    if has_function_privilege('anon', 'public.' || v_sig, 'EXECUTE') then
      raise exception 'Stage C failed: the public key can still execute public.%.', v_sig
        using hint = 'revoke all on function public.' || v_sig || ' from public, anon;';
    end if;
  end loop;
end $$;

commit;

-- ============================================================
-- ROLLBACK — restores the previous (leaky) behaviour. Recovery only.
-- ============================================================
-- begin;
-- drop policy if exists "buyers read own" on buyers;
-- drop policy if exists "buyers insert neutral stub" on buyers;
-- create policy "buyers read" on buyers for select to authenticated using (true);
-- create policy "buyers insert stub" on buyers for insert to authenticated
--   with check (
--     coalesce(risk_score, 0.5) = 0.5 and coalesce(total_orders, 0) = 0
--     and coalesce(total_accepted, 0) = 0 and coalesce(total_refused, 0) = 0
--   );
-- grant select, insert on buyers to authenticated; grant all on buyers to anon;
-- drop policy if exists "user owns their chats" on chats;
-- drop policy if exists "chat_messages own" on chat_messages;
-- create policy "chats all" on chats for all to authenticated using (true) with check (true);
-- create policy "chat_messages all" on chat_messages for all to authenticated using (true) with check (true);
-- drop policy if exists "admins read own row" on verafo_admins;
-- create policy "admins readable" on verafo_admins for select to authenticated using (true);
-- grant execute on function find_similar_buyers(vector, int) to authenticated, anon;
-- commit;
--
-- NOTE — rows that predate this file:
--   `chats` rows created before created_by existed have created_by = NULL, so
--   they are now invisible to every browser session (fail-closed, by design).
--   Nothing on the row says who owned it, so attribute them by hand if they
--   matter, or drop them:
--     update chats set created_by = (select id from auth.users where email = 'you@example.com')
--      where created_by is null;
--     -- or: delete from chats where created_by is null;
--
-- OPTIONAL PATCH — only if logging a SECOND order for an existing buyer fails
-- with "new row violates row-level security policy for table buyers" (that
-- would mean ON CONFLICT DO NOTHING re-checks the policy against the existing
-- row on your Postgres version). In that case:
--   1. add a SECURITY DEFINER `verafo_ensure_buyer(p_phone text)` that
--      validates the number, does `insert into buyers (phone) values (…) on
--      conflict (phone) do nothing`, returns void, and is granted to
--      authenticated + service_role only;
--   2. `drop policy "buyers insert neutral stub" on buyers;` and
--      `revoke insert on buyers from authenticated;`
--   3. change src/pages/NewOrder.tsx and src/pages/BulkImport.tsx to call
--      `supabase.rpc('verafo_ensure_buyer', { p_phone })` instead of the
--      buyers upsert.
-- The runbook's two-order check tells you which case you are in.
