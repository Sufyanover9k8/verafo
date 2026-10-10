-- ============================================================
-- Verafo — PRIVACY ISOLATION TESTS
--
-- ⚠️⚠️⚠️  TEST / PRACTICE PROJECT ONLY.  ⚠️⚠️⚠️
-- THIS FILE CREATES AND THEN DELETES FAKE MERCHANTS, STORES, ORDERS, BUYERS,
-- CHATS, LOOKUPS, DECISIONS AND AN ADMIN ROW. **NEVER RUN IT AGAINST
-- PRODUCTION.** Run it in the throw-away practice project described in
-- RUNBOOK-PRIVACY.md and nowhere else.
--
-- WHAT IT DOES
--   · creates two fake merchants, A and B, each with a store, a buyer, an
--     order, an outcome, a chat and chat messages, plus one lookup, one
--     order decision and one image of an admin row. A third user, C, owns
--     nothing (used for the "not a store owner" refusal);
--   · then plays B (an authenticated user with a store) and anon (the public
--     key) and tries to READ and WRITE A's data in every table and through
--     every privacy-relevant function. A negative check PASSES when B/anon get
--     nothing or an error;
--   · then plays A and checks the paths that MUST still work (own data, phone
--     lookup in both formats, the daily limit, the order → score trigger).
--
-- HOW TO READ THE OUTPUT
--   Every check prints one line: "PASS | area | check name | detail".
--   Two tables at the end list every check and the number of failures.
--
--   BEFORE Stage C: FAILs on buyers, chats, chat_messages and verafo_admins
--                   are EXPECTED — those open policies still exist.
--   AFTER  Stage C: EVERY line must read PASS and failures must be 0.
--
-- CLEAN UP
--   The whole file is ONE transaction that ends in ROLLBACK, so it leaves
--   nothing behind (tables, functions and all fake rows disappear). Do not
--   "tidy" that rollback into a commit. An explicit delete-everything version
--   is in the comments at the very bottom.
--
-- NOTE: this schema has no views (there is no CREATE VIEW in supabase/*.sql),
-- so "every table" plus "every function" is the whole surface.
-- ============================================================

begin;

-- ── 0. Preconditions ────────────────────────────────────────
do $$
begin
  if to_regclass('public.buyers') is null or to_regclass('public.chats') is null then
    raise exception 'Run the base SQL files first (schema.sql, rls-production.sql, ...) - buyers/chats are missing.';
  end if;
  if not pg_has_role(current_user, 'authenticated', 'MEMBER')
     or not pg_has_role(current_user, 'anon', 'MEMBER') then
    raise exception 'These tests must run from the Supabase SQL editor (as a role that is a MEMBER of anon and authenticated so it can SET ROLE to them).';
  end if;
end $$;

-- ── 1. Result plumbing ──────────────────────────────────────
create temporary table verafo_test_results (
  id serial primary key,
  area text not null,
  check_name text not null,
  ok boolean not null,
  detail text
) on commit drop;

-- Records one check. SECURITY DEFINER so it can write the result table no
-- matter which role is playing at the time.
create function pg_temp.verafo_note(p_area text, p_name text, p_ok boolean, p_detail text default null)
returns void
language plpgsql
security definer
set search_path = pg_temp, public, extensions
as $$
begin
  insert into verafo_test_results (area, check_name, ok, detail) values (p_area, p_name, p_ok, p_detail);
  raise notice '% | % | % | %',
    case when p_ok then 'PASS' else 'FAIL' end, p_area, p_name, coalesce(p_detail, '');
end;
$$;

-- Runs p_sql AS p_role (with those JWT claims) and reports what happened.
--   read  → 'ok:<value>' or 'error:<sqlstate>:<message>'
--   write → 'ok:<rows affected>' or 'error:<sqlstate>:<message>'
--
-- ⚠️ THIS MUST BE **SECURITY INVOKER** (the default). PostgreSQL deliberately
-- forbids SET ROLE inside a SECURITY DEFINER function, because the definer's
-- privileges make the switch unsafe. So the role switch happens here, running
-- as the caller (the SQL editor's role, which owns the tables), and the tested
-- SQL really does run with the tested role's privileges and its RLS.
-- The recording helper above is SECURITY DEFINER for the opposite reason: it
-- must be able to write the result table no matter which role just ran.
create function pg_temp.verafo_probe(p_role text, p_claims text, p_sql text, p_write boolean)
returns text
language plpgsql
set search_path = pg_temp, public, extensions
as $$
declare
  v_val text;
  v_rows bigint;
begin
  if p_role is not null and p_role <> '' then
    execute format('set local role %I', p_role);
  end if;
  if p_claims is not null then
    execute format('set local request.jwt.claims = %L', p_claims);
  end if;

  begin
    if p_write then
      execute p_sql;
      get diagnostics v_rows = row_count;
      v_val := 'ok:' || v_rows::text;
    else
      execute p_sql into v_val;
      v_val := 'ok:' || coalesce(v_val, 'null');
    end if;
  exception when others then
    v_val := 'error:' || sqlstate || ':' || sqlerrm;
  end;

  execute 'reset role';
  return v_val;
end;
$$;

-- A negative check: the answer must be "nothing" (0 rows) or an error.
-- SECURITY INVOKER, like verafo_probe (it calls it; it cannot switch roles
-- itself as a definer function). verafo_note below is definer and records.
create function pg_temp.verafo_deny(p_area text, p_name text, p_role text, p_claims text, p_sql text, p_write boolean default false)
returns void
language plpgsql
set search_path = pg_temp, public, extensions
as $$
declare
  v_out text;
begin
  v_out := pg_temp.verafo_probe(p_role, p_claims, p_sql, p_write);
  perform pg_temp.verafo_note(p_area, p_name, v_out = 'ok:0' or v_out like 'error:%', v_out);
end;
$$;

-- An explicit expectation on the probe output (used for the allowed paths).
-- SECURITY INVOKER for the same reason as verafo_deny.
create function pg_temp.verafo_expect(p_area text, p_name text, p_actual text, p_expected text)
returns void
language plpgsql
set search_path = pg_temp, public, extensions
as $$
begin
  perform pg_temp.verafo_note(p_area, p_name, p_actual = p_expected, p_actual || ' (expected ' || p_expected || ')');
end;
$$;

-- ── 2. Fake data + every check ──────────────────────────────
do $$
declare
  -- three fake users
  v_a_uid uuid := '11111111-1111-4111-8111-111111111111';
  v_b_uid uuid := '22222222-2222-4222-8222-222222222222';
  v_c_uid uuid := '33333333-3333-4333-8333-333333333333';
  v_a_claims text;
  v_b_claims text;
  v_c_claims text;
  v_anon_claims text := '{}';
  -- fake rows
  v_a_store uuid := 'aaaaaaaa-1111-4111-8111-111111111111';
  v_b_store uuid := 'bbbbbbbb-2222-4222-8222-222222222222';
  v_a_order uuid := 'aaaaaaaa-3333-4333-8333-333333333333';
  v_b_order uuid := 'bbbbbbbb-4444-4444-8444-444444444444';
  v_a_chat uuid := 'aaaaaaaa-5555-4555-8555-555555555555';
  v_b_chat uuid := 'bbbbbbbb-6666-4666-8666-666666666666';
  v_a_phone text := '+923001110001';   -- the 13-character form
  v_a_phone_short text := '03001110001'; -- the same number, 11-character form
  v_b_phone text := '03001110002';
  v_new_phone text := '+923001119999';  -- used by the "log an order" checks
  v_fake_admin text := 'privacy-test-admin@example.com';
  v_has_config boolean;
  v_has_decisions boolean;
  v_has_created_by boolean;
  v_out text;
  v_before text;
  v_after text;
begin
  v_a_claims := format('{"sub":"%s","email":"privacy-a@example.com","role":"authenticated"}', v_a_uid);
  v_b_claims := format('{"sub":"%s","email":"privacy-b@example.com","role":"authenticated"}', v_b_uid);
  v_c_claims := format('{"sub":"%s","email":"privacy-c@example.com","role":"authenticated"}', v_c_uid);

  -- ── 2a. Seed (as the SQL editor role: the table owner, so RLS is bypassed)
  insert into stores (id, name, owner_email)
  values (v_a_store, 'Privacy Test Store A', 'privacy-a@example.com'),
         (v_b_store, 'Privacy Test Store B', 'privacy-b@example.com')
  on conflict (id) do nothing;

  insert into buyers (phone, first_seen, total_orders, total_accepted, risk_score)
  values (v_a_phone, now() - interval '40 days', 3, 3, 0.10),
         (v_b_phone, now() - interval '2 days', 1, 1, 0.40)
  on conflict (phone) do nothing;

  insert into orders (id, buyer_phone, store_id, product_name, price, quantity, ordered_at)
  values (v_a_order, v_a_phone, v_a_store, 'A private serum', 1500, 1, now() - interval '3 days'),
         (v_b_order, v_b_phone, v_b_store, 'B serum', 900, 1, now())
  on conflict (id) do nothing;

  insert into outcomes (order_id, status, resolved_at)
  values (v_a_order, 'accepted', now() - interval '2 days'),
         (v_b_order, 'accepted', now())
  on conflict (order_id) do nothing;

  insert into lookups (buyer_phone, owner_email, searched_at)
  values (v_a_phone, 'privacy-a@example.com', now());

  -- Seeding the orders and outcomes fires the scoring triggers, which recompute
  -- these two buyers. Pin the values the checks below assert on AFTER the seed,
  -- so a trigger run during seeding cannot make the expectations wobble.
  update buyers
     set risk_score = 0.10, total_orders = 3, total_accepted = 3, total_refused = 0
   where phone = v_a_phone;
  update buyers
     set risk_score = 0.40, total_orders = 1, total_accepted = 1, total_refused = 0
   where phone = v_b_phone;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chats' and column_name = 'created_by'
  ) into v_has_created_by;

  if v_has_created_by then
    execute format('insert into chats (id, title, created_by) values (%L, %L, %L)', v_a_chat, 'A private chat', v_a_uid);
    execute format('insert into chats (id, title, created_by) values (%L, %L, %L)', v_b_chat, 'B chat', v_b_uid);
  else
    -- Before Stage C the column does not exist yet (that is the point of the
    -- chats checks below).
    execute format('insert into chats (id, title) values (%L, %L)', v_a_chat, 'A private chat');
    execute format('insert into chats (id, title) values (%L, %L)', v_b_chat, 'B chat');
    raise notice 'NOTE | chats.created_by does not exist yet - the chats checks below must FAIL until Stage C adds it.';
  end if;

  insert into chat_messages (chat_id, role, content)
  values (v_a_chat, 'user', 'A secret question'),
         (v_b_chat, 'user', 'B question');

  insert into verafo_admins (email) values (v_fake_admin) on conflict (email) do nothing;

  select to_regclass('public.verafo_config') is not null into v_has_config;
  select to_regclass('public.order_decisions') is not null into v_has_decisions;

  if v_has_decisions then
    insert into order_decisions (order_id, decision, actor_email, note)
    values (v_a_order, 'hold', 'privacy-a@example.com', 'A private decision');
  else
    raise notice 'NOTE | order_decisions does not exist - run supabase/order-decisions-migration.sql to test it.';
  end if;

  if not v_has_config then
    raise notice 'NOTE | verafo_config does not exist in this project - its checks are skipped.';
  end if;

  -- ── 2b. As B (authenticated, owns store B): reads must leak nothing ──
  perform pg_temp.verafo_deny('buyers', 'B cannot read A''s buyer', 'authenticated', v_b_claims,
    format('select count(*)::text from buyers where phone = %L', v_a_phone));
  perform pg_temp.verafo_deny('orders', 'B cannot read A''s order', 'authenticated', v_b_claims,
    format('select count(*)::text from orders where store_id = %L', v_a_store));
  perform pg_temp.verafo_deny('outcomes', 'B cannot read A''s outcome', 'authenticated', v_b_claims,
    format('select count(*)::text from outcomes where order_id = %L', v_a_order));
  perform pg_temp.verafo_deny('lookups', 'B cannot read A''s lookup history', 'authenticated', v_b_claims,
    'select count(*)::text from lookups where owner_email = ''privacy-a@example.com''');
  perform pg_temp.verafo_deny('chats', 'B cannot read A''s chat', 'authenticated', v_b_claims,
    format('select count(*)::text from chats where id = %L', v_a_chat));
  perform pg_temp.verafo_deny('chat_messages', 'B cannot read A''s messages', 'authenticated', v_b_claims,
    format('select count(*)::text from chat_messages where chat_id = %L', v_a_chat));
  perform pg_temp.verafo_deny('stores', 'B cannot read A''s store', 'authenticated', v_b_claims,
    format('select count(*)::text from stores where id = %L', v_a_store));
  perform pg_temp.verafo_deny('verafo_admins', 'B cannot read the admin list', 'authenticated', v_b_claims,
    format('select count(*)::text from verafo_admins where email = %L', v_fake_admin));

  if v_has_decisions then
    perform pg_temp.verafo_deny('order_decisions', 'B cannot read A''s decision', 'authenticated', v_b_claims,
      format('select count(*)::text from order_decisions where order_id = %L', v_a_order));
  end if;

  if v_has_config then
    perform pg_temp.verafo_deny('verafo_config', 'B cannot read verafo_config', 'authenticated', v_b_claims,
      'select count(*)::text from verafo_config');
  end if;

  -- ── 2c. As B: writes must be refused (0 rows changed, or an error) ──
  perform pg_temp.verafo_deny('buyers', 'B cannot rewrite A''s risk score', 'authenticated', v_b_claims,
    format('update buyers set risk_score = 0.99 where phone = %L', v_a_phone), true);
  perform pg_temp.verafo_deny('buyers', 'B cannot delete A''s buyer', 'authenticated', v_b_claims,
    format('delete from buyers where phone = %L', v_a_phone), true);
  perform pg_temp.verafo_deny('buyers', 'B cannot insert a pre-scored buyer', 'authenticated', v_b_claims,
    'insert into buyers (phone, risk_score) values (''+923001118888'', 0.01)', true);
  perform pg_temp.verafo_deny('orders', 'B cannot reprice A''s order', 'authenticated', v_b_claims,
    format('update orders set price = 1 where store_id = %L', v_a_store), true);
  perform pg_temp.verafo_deny('outcomes', 'B cannot change A''s outcome', 'authenticated', v_b_claims,
    format('update outcomes set status = ''refused'' where order_id = %L', v_a_order), true);
  perform pg_temp.verafo_deny('lookups', 'B cannot delete A''s lookups', 'authenticated', v_b_claims,
    'delete from lookups where owner_email = ''privacy-a@example.com''', true);
  perform pg_temp.verafo_deny('lookups', 'B cannot file a lookup as A', 'authenticated', v_b_claims,
    format('insert into lookups (buyer_phone, owner_email) values (%L, ''privacy-a@example.com'')', v_a_phone), true);
  perform pg_temp.verafo_deny('stores', 'B cannot rename A''s store', 'authenticated', v_b_claims,
    format('update stores set name = ''hacked'' where id = %L', v_a_store), true);
  perform pg_temp.verafo_deny('chats', 'B cannot rename A''s chat', 'authenticated', v_b_claims,
    format('update chats set title = ''hacked'' where id = %L', v_a_chat), true);
  perform pg_temp.verafo_deny('chats', 'B cannot delete A''s chat', 'authenticated', v_b_claims,
    format('delete from chats where id = %L', v_a_chat), true);
  perform pg_temp.verafo_deny('chat_messages', 'B cannot add a message to A''s chat', 'authenticated', v_b_claims,
    format('insert into chat_messages (chat_id, role, content) values (%L, ''user'', ''injected'')', v_a_chat), true);
  perform pg_temp.verafo_deny('verafo_admins', 'B cannot add itself as admin', 'authenticated', v_b_claims,
    'insert into verafo_admins (email) values (''privacy-b@example.com'')', true);

  if v_has_decisions then
    perform pg_temp.verafo_deny('order_decisions', 'B cannot decide A''s order', 'authenticated', v_b_claims,
      format('insert into order_decisions (order_id, decision, actor_email) values (%L, ''ship'', ''privacy-b@example.com'')', v_a_order), true);
  end if;

  if v_has_config then
    perform pg_temp.verafo_deny('verafo_config', 'B cannot rewrite verafo_config', 'authenticated', v_b_claims,
      'update verafo_config set key = ''hacked''', true);
  end if;

  -- A's data must be untouched by all of the attempts above.
  perform pg_temp.verafo_expect('buyers', 'A''s risk score is unchanged after B''s attempts',
    pg_temp.verafo_probe('', null, format('select risk_score::text from buyers where phone = %L', v_a_phone), false), 'ok:0.10');
  perform pg_temp.verafo_expect('chats', 'A''s chat title is unchanged after B''s attempts',
    pg_temp.verafo_probe('', null, format('select title from chats where id = %L', v_a_chat), false), 'ok:A private chat');

  -- ── 2d. As B: functions that must not be callable / must not leak ──
  perform pg_temp.verafo_deny('functions', 'B cannot execute verafo_buyer_ranking', 'authenticated', v_b_claims,
    'select count(*)::text from verafo_buyer_ranking(''{}''::uuid[])');
  perform pg_temp.verafo_deny('functions', 'B cannot execute find_similar_buyers', 'authenticated', v_b_claims,
    'select count(*)::text from find_similar_buyers(null::vector, 5)');
  perform pg_temp.verafo_deny('functions', 'B cannot execute recompute_buyer', 'authenticated', v_b_claims,
    format('select recompute_buyer(%L)::text', v_a_phone));
  perform pg_temp.verafo_deny('functions', 'B cannot execute upsert_store_for_shop', 'authenticated', v_b_claims,
    'select upsert_store_for_shop(''privacy-test.myshopify.com'')::text');
  perform pg_temp.verafo_deny('functions', 'B cannot read A''s store through store_overview', 'authenticated', v_b_claims,
    format('select count(*)::text from store_overview() where id = %L', v_a_store));
  perform pg_temp.verafo_deny('functions', 'B cannot find A''s store with search_stores', 'authenticated', v_b_claims,
    'select count(*)::text from search_stores(''Privacy Test Store A'', 8)');
  perform pg_temp.verafo_deny('functions', 'daily_sales shows B nothing of A''s store', 'authenticated', v_b_claims,
    format('select coalesce(sum(orders), 0)::text from daily_sales(%L, 7)', v_a_store));

  -- The allowed cross-store path: a store owner may ask about a number they
  -- already know. B gets aggregates only - never A's identity.
  perform pg_temp.verafo_expect('functions', 'B may look up a known number (aggregates only)',
    pg_temp.verafo_probe('authenticated', v_b_claims, format('select count(*)::text from buyer_network_lookup(%L)', v_a_phone), false), 'ok:1');
  perform pg_temp.verafo_deny('functions', 'C (no store, not admin) may NOT look a buyer up', 'authenticated', v_c_claims,
    format('select count(*)::text from buyer_network_lookup(%L)', v_a_phone));
  perform pg_temp.verafo_deny('functions', 'anon may NOT look a buyer up', 'anon', v_anon_claims,
    format('select count(*)::text from buyer_network_lookup(%L)', v_a_phone));

  -- ── 2e. As anon: nothing may be readable or writable ──
  perform pg_temp.verafo_deny('anon', 'anon cannot read buyers', 'anon', v_anon_claims,
    'select count(*)::text from buyers');
  perform pg_temp.verafo_deny('anon', 'anon cannot read orders', 'anon', v_anon_claims,
    'select count(*)::text from orders');
  perform pg_temp.verafo_deny('anon', 'anon cannot read outcomes', 'anon', v_anon_claims,
    'select count(*)::text from outcomes');
  perform pg_temp.verafo_deny('anon', 'anon cannot read lookups', 'anon', v_anon_claims,
    'select count(*)::text from lookups');
  perform pg_temp.verafo_deny('anon', 'anon cannot read chats', 'anon', v_anon_claims,
    'select count(*)::text from chats');
  perform pg_temp.verafo_deny('anon', 'anon cannot read chat_messages', 'anon', v_anon_claims,
    'select count(*)::text from chat_messages');
  perform pg_temp.verafo_deny('anon', 'anon cannot read stores', 'anon', v_anon_claims,
    'select count(*)::text from stores');
  perform pg_temp.verafo_deny('anon', 'anon cannot read verafo_admins', 'anon', v_anon_claims,
    'select count(*)::text from verafo_admins');
  perform pg_temp.verafo_deny('anon', 'anon cannot write buyers', 'anon', v_anon_claims,
    'insert into buyers (phone) values (''+923001117777'')', true);
  perform pg_temp.verafo_deny('anon', 'anon cannot write orders', 'anon', v_anon_claims,
    format('insert into orders (buyer_phone, store_id) values (%L, %L)', v_a_phone, v_a_store), true);
  perform pg_temp.verafo_deny('anon', 'anon cannot write chats', 'anon', v_anon_claims,
    'insert into chats (title) values (''anon chat'')', true);
  perform pg_temp.verafo_deny('anon', 'anon cannot write chat_messages', 'anon', v_anon_claims,
    format('insert into chat_messages (chat_id, role, content) values (%L, ''user'', ''anon'')', v_a_chat), true);
  perform pg_temp.verafo_deny('anon', 'anon cannot write stores', 'anon', v_anon_claims,
    format('update stores set name = ''anon'' where id = %L', v_a_store), true);
  perform pg_temp.verafo_deny('anon', 'anon cannot write lookups', 'anon', v_anon_claims,
    format('insert into lookups (buyer_phone, owner_email) values (%L, ''anon@example.com'')', v_a_phone), true);

  if v_has_decisions then
    perform pg_temp.verafo_deny('anon', 'anon cannot read order_decisions', 'anon', v_anon_claims,
      'select count(*)::text from order_decisions');
  end if;
  if v_has_config then
    perform pg_temp.verafo_deny('anon', 'anon cannot read verafo_config', 'anon', v_anon_claims,
      'select count(*)::text from verafo_config');
  end if;

  -- ── 2f. As anon: the public surface of functions is closed ──
  perform pg_temp.verafo_deny('anon', 'anon cannot execute network_kpis', 'anon', v_anon_claims, 'select (network_kpis()).stores::text');
  perform pg_temp.verafo_deny('anon', 'anon cannot execute store_overview', 'anon', v_anon_claims, 'select count(*)::text from store_overview()');
  perform pg_temp.verafo_deny('anon', 'anon cannot execute search_stores', 'anon', v_anon_claims, 'select count(*)::text from search_stores(''a'', 8)');
  perform pg_temp.verafo_deny('anon', 'anon cannot execute daily_sales', 'anon', v_anon_claims, 'select count(*)::text from daily_sales(null, 7)');
  perform pg_temp.verafo_deny('anon', 'anon cannot execute upsert_store_for_shop', 'anon', v_anon_claims, 'select upsert_store_for_shop(''anon.myshopify.com'')::text');
  perform pg_temp.verafo_deny('anon', 'anon cannot execute verafo_aggregate_stats', 'anon', v_anon_claims, 'select count(*)::text from verafo_aggregate_stats(''city'', 30)');
  perform pg_temp.verafo_deny('anon', 'anon cannot execute similar_buyers_by_phone', 'anon', v_anon_claims, format('select count(*)::text from similar_buyers_by_phone(%L)', v_a_phone));
  perform pg_temp.verafo_deny('anon', 'anon cannot execute verafo_is_admin', 'anon', v_anon_claims, 'select verafo_is_admin()::text');
  perform pg_temp.verafo_deny('anon', 'anon cannot execute verafo_my_store_ids', 'anon', v_anon_claims, 'select count(*)::text from verafo_my_store_ids()');
  perform pg_temp.verafo_deny('anon', 'anon cannot execute verafo_current_email', 'anon', v_anon_claims, 'select verafo_current_email()');
  perform pg_temp.verafo_deny('anon', 'anon cannot execute recompute_buyer', 'anon', v_anon_claims, 'select recompute_buyer(''+923001110001'')::text');

  -- ── 2g. Allowed paths as A (owner of store A) ──
  perform pg_temp.verafo_expect('allowed', 'A reads A''s own buyer',
    pg_temp.verafo_probe('authenticated', v_a_claims, format('select count(*)::text from buyers where phone = %L', v_a_phone), false), 'ok:1');
  perform pg_temp.verafo_expect('allowed', 'A reads A''s own chat',
    pg_temp.verafo_probe('authenticated', v_a_claims, format('select count(*)::text from chats where id = %L', v_a_chat), false), 'ok:1');
  perform pg_temp.verafo_expect('allowed', 'A reads A''s own messages',
    pg_temp.verafo_probe('authenticated', v_a_claims, format('select count(*)::text from chat_messages where chat_id = %L', v_a_chat), false), 'ok:1');
  perform pg_temp.verafo_expect('allowed', 'A reads A''s own store through store_overview',
    pg_temp.verafo_probe('authenticated', v_a_claims, format('select count(*)::text from store_overview() where id = %L', v_a_store), false), 'ok:1');
  perform pg_temp.verafo_note('allowed', 'A may call verafo_aggregate_stats',
    pg_temp.verafo_probe('authenticated', v_a_claims, 'select count(*)::text from verafo_aggregate_stats(''city'', 365)', false) like 'ok:%');
  perform pg_temp.verafo_expect('allowed', 'A writes A''s own chat',
    pg_temp.verafo_probe('authenticated', v_a_claims, format('update chats set title = ''A renamed'' where id = %L', v_a_chat), true), 'ok:1');

  -- The phone-format check: +92 and 03 must reach the same buyer, and the
  -- answer must be aggregates only (a month, not a timestamp).
  v_out := pg_temp.verafo_probe('authenticated', v_a_claims, format('select risk_score::text from buyer_network_lookup(%L)', v_a_phone), false);
  v_before := pg_temp.verafo_probe('authenticated', v_a_claims, format('select risk_score::text from buyer_network_lookup(%L)', v_a_phone_short), false);
  perform pg_temp.verafo_expect('allowed', 'lookup finds the buyer with the +92 form', v_out, 'ok:0.10');
  perform pg_temp.verafo_expect('allowed', 'lookup finds the SAME buyer with the 03 form', v_before, v_out);
  perform pg_temp.verafo_expect('allowed', 'lookup returns first_seen as a month only',
    pg_temp.verafo_probe('authenticated', v_a_claims, format('select (first_seen ~ ''^[0-9]{4}-[0-9]{2}$'')::text from buyer_network_lookup(%L)', v_a_phone), false),
    'ok:true');
  -- Every field the lookup returns, glued into one string, must not contain a
  -- phone-like digit run: no number, no identity, no vector can hide in it.
  perform pg_temp.verafo_note('allowed', 'the lookup row contains no phone number',
    pg_temp.verafo_probe('authenticated', v_a_claims,
      format('select (risk_score::text || '' '' || total_orders::text || '' '' || total_accepted::text || '' '' || total_refused::text || '' '' || store_count::text || '' '' || first_seen) from buyer_network_lookup(%L)', v_a_phone),
      false)
      !~ '[+]?92[0-9]{10}|0[0-9]{10}');

  -- A logs a brand-new order: the stub insert, then the order, then the
  -- outcome - and the SECURITY DEFINER trigger must update the buyer.
  perform pg_temp.verafo_expect('allowed', 'A creates a new buyer stub',
    pg_temp.verafo_probe('authenticated', v_a_claims, format('insert into buyers (phone) values (%L)', v_new_phone), true), 'ok:1');
  perform pg_temp.verafo_expect('allowed', 'A logs an order for the new buyer',
    pg_temp.verafo_probe('authenticated', v_a_claims,
      format('insert into orders (buyer_phone, store_id, product_name, price, quantity) values (%L, %L, ''A new order'', 1000, 1)', v_new_phone, v_a_store), true),
    'ok:1');
  perform pg_temp.verafo_expect('allowed', 'A marks the order accepted',
    pg_temp.verafo_probe('authenticated', v_a_claims,
      format('insert into outcomes (order_id, status) select id, ''accepted'' from orders where buyer_phone = %L limit 1', v_new_phone), true),
    'ok:1');
  perform pg_temp.verafo_expect('allowed', 'the trigger updated the buyer totals under A''s role',
    pg_temp.verafo_probe('authenticated', v_a_claims, format('select (total_orders::text || ''/'' || total_accepted::text) from buyers where phone = %L', v_new_phone), false),
    'ok:1/1');

  v_before := pg_temp.verafo_probe('authenticated', v_a_claims, format('select risk_score::text from buyers where phone = %L', v_new_phone), false);
  perform pg_temp.verafo_expect('allowed', 'A marks the outcome refused',
    pg_temp.verafo_probe('authenticated', v_a_claims,
      format('update outcomes set status = ''refused'' where order_id = (select id from orders where buyer_phone = %L limit 1)', v_new_phone), true),
    'ok:1');
  v_after := pg_temp.verafo_probe('authenticated', v_a_claims, format('select risk_score::text from buyers where phone = %L', v_new_phone), false);
  perform pg_temp.verafo_note('allowed', 'the trigger re-scored the buyer after the outcome change',
    v_after like 'ok:%' and v_after <> v_before, v_before || ' -> ' || v_after);
  perform pg_temp.verafo_expect('allowed', 'the buyer now shows one refused order',
    pg_temp.verafo_probe('authenticated', v_a_claims, format('select total_refused::text from buyers where phone = %L', v_new_phone), false),
    'ok:1');

  -- The daily lookup limit (200 per user per 24 hours). 200 rows are filed for
  -- A, so the next lookup must raise the clear error.
  insert into lookups (buyer_phone, owner_email, searched_at)
  select v_a_phone, 'privacy-a@example.com', now()
  from generate_series(1, 200);

  v_out := pg_temp.verafo_probe('authenticated', v_a_claims, format('select risk_score::text from buyer_network_lookup(%L)', v_a_phone), false);
  perform pg_temp.verafo_note('allowed', 'the 201st lookup raises the clear limit error',
    v_out like '%Lookup limit reached%', v_out);
end $$;

-- ── 3. Results ──────────────────────────────────────────────
select case when ok then 'PASS' else 'FAIL' end as result, area, check_name, detail
from verafo_test_results
order by id;

select count(*) as checks, count(*) filter (where not ok) as failures
from verafo_test_results;

do $$
begin
  raise notice 'REMINDER | before Stage C, FAILs are EXPECTED on buyers, chats, chat_messages, verafo_admins, verafo_config and every anon-callable function (network_kpis, store_overview, search_stores, daily_sales, upsert_store_for_shop, verafo_is_admin, verafo_current_email, verafo_my_store_ids). After Stage C every line must read PASS.';
end $$;

-- Nothing is kept: this rolls back the seed data, the helper functions and the
-- result table in one go.
rollback;

-- ============================================================
-- IF YOU EVER NEED A COMMITTING VERSION (practice project only)
-- ============================================================
-- Replace the rollback above with the deletes below, and drop the temp objects
-- yourself (they disappear when the session ends):
--   delete from order_decisions where actor_email = 'privacy-a@example.com';
--   delete from chat_messages where chat_id in (select id from chats where title in ('A private chat','B chat'));
--   delete from chats where title in ('A private chat','B chat');
--   delete from outcomes  where order_id in (select id from orders where store_id in ('aaaaaaaa-1111-4111-8111-111111111111','bbbbbbbb-2222-4222-8222-222222222222'));
--   delete from orders    where store_id in ('aaaaaaaa-1111-4111-8111-111111111111','bbbbbbbb-2222-4222-8222-222222222222');
--   delete from lookups   where owner_email = 'privacy-a@example.com';
--   delete from buyers    where phone in ('+923001110001','03001110002','+923001119999','+923001118888','+923001117777');
--   delete from stores    where id in ('aaaaaaaa-1111-4111-8111-111111111111','bbbbbbbb-2222-4222-8222-222222222222');
--   delete from verafo_admins where email = 'privacy-test-admin@example.com';
