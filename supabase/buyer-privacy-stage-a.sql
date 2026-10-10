-- ============================================================
-- Verafo — PRIVACY STAGE A: the safe read path
--   [PRODUCTION INCIDENT FIX — PART 1 OF 2]
--
-- APPLY ORDER (this is the important part)
--   STAGE A (this file)  → adds/updates the safe functions. Touches no
--                          policy and no grant the running app depends on.
--   STAGE B              → deploy the frontend + edge function.
--   STAGE C              → apply restrictive RLS + revoke the legacy
--                          function (buyer-privacy-stage-c.sql).
--
-- WHY THIS ORDER
-- `buyer_network_lookup` and `similar_buyers_by_phone` DO NOT EXIST in
-- production. The updated frontend already calls them, so:
--     Stage A MUST be applied BEFORE the frontend is deployed.
-- If the frontend went first, Buyer Lookup and the New Order preview
-- would fail immediately.
--
-- WHAT THIS FILE CHANGED IN THE HARDENING PASS
--   1. Phones are matched by the LAST 10 DIGITS of the national number, so
--      "+923001112222" (the 13-character form, 198 rows in production) and
--      "03001112222" (the 11-character form, 174 rows) resolve to the same
--      buyer. Only a complete Pakistani mobile or landline shape is accepted,
--      so the PostgREST surface still cannot be probed with partial strings.
--   2. Both functions now verify the CALLER: a store owner (stores.owner_email
--      = the JWT email), an admin, or the service role. Anyone else is refused
--      with a clear error.
--   3. buyer_network_lookup is VOLATILE and rate-limited to 200 lookups per
--      user per 24 hours, logged in `lookups` with owner_email.
--   4. `first_seen` is returned as a MONTH ("2025-03"), never a full timestamp.
--
-- Neither function ever returns a phone number, an identity, a store name,
-- an order row or an embedding/vector.
--
-- DEPENDENCY: supabase/rls-production.sql must already have been run
-- (verafo_is_admin, verafo_current_email, verafo_my_store_ids) and the
-- `lookups` table must have its owner_email column.
--
-- Rollback is at the bottom.
-- ============================================================

begin;

-- ── 0. Preconditions ────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.verafo_is_admin()') is null
     or to_regprocedure('public.verafo_current_email()') is null then
    raise exception 'Stage A needs supabase/rls-production.sql first: verafo_is_admin() / verafo_current_email() are missing.';
  end if;
  if to_regclass('public.lookups') is null then
    raise exception 'Stage A needs the lookups table (supabase/lookups-migration.sql or rls-production.sql).';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lookups' and column_name = 'owner_email'
  ) then
    raise exception 'Stage A needs lookups.owner_email (supabase/rls-production.sql section 8).';
  end if;
end $$;

-- ── 1. One key for every way a Pakistani number is written ──
-- Digits only, the country code and the trunk 0 removed, then the LAST 10
-- DIGITS. This is the value two rows are matched on, so "+92…", "92…",
-- "0092…" and "0…" all reach the same subscriber number.
--
-- No validation happens here: verafo_normalize_phone() below rejects anything
-- that is not a real Pakistani shape.
create or replace function verafo_phone_key(p_raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  with digits as (
    select regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as d
  ),
  national as (
    select
      case
        when d = ''         then null
        when d like '0092%' then substr(d, 5)   -- 0092 300 1112222
        when d like '92%'   then substr(d, 3)   -- 92 300 1112222
        when d like '0%'    then substr(d, 2)   -- 0300 1112222
        else d
      end as n
    from digits
  ),
  trunkless as (
    -- "92 0300 1112222" (a country code in front of a trunk 0) is the same
    -- subscriber number as "0300 1112222".
    select case when n like '0%' then substr(n, 2) else n end as t
    from national
  )
  select case when t is null or t = '' then null else right(t, 10) end
  from trunkless;
$$;

-- ── 2. Strict phone input ───────────────────────────────────
-- Only a complete national number is accepted:
--   mobile   3XX XXXXXXX            (10 digits, e.g. 3001112222)
--   landline 2-digit area code + 7-9 digits (e.g. 4235678901, 512345678)
-- Anything else — a partial string, a different country, the "+1…" test
-- rows — returns null, so it can never reach a query.
create or replace function verafo_normalize_phone(p_raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    case
      when k is null then null
      when k ~ '^3[0-9]{9}$' then k
      -- Area codes start 2, 4, 5, 6, 7, 8 or 9. Mobile is handled above.
      when k ~ '^[2456789][0-9]{7,9}$' then k
      else null
    end
  from (select verafo_phone_key(p_raw) as k) s;
$$;

-- ── 3. Who may look a buyer up ──────────────────────────────
-- Returns the caller's email, or null for the service role (server-side
-- call: there is no user to attribute a lookup to).
--
-- SECURITY DEFINER on purpose: the owner/admin test must read `stores` and
-- `verafo_admins` as the function owner, not through the caller's RLS.
create or replace function verafo_lookup_caller_email()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
begin
  -- The service role (edge function, migrations) has no end user: it is
  -- allowed and simply is not rate-limited or logged.
  if current_user in ('service_role', 'postgres', 'supabase_admin')
     or session_user in ('service_role', 'postgres', 'supabase_admin') then
    return null;
  end if;

  if auth.uid() is null then
    raise exception 'Not allowed: sign in to look up a buyer.' using errcode = '42501';
  end if;

  v_email := verafo_current_email();
  if v_email is null then
    raise exception 'Not allowed: your session has no email address.' using errcode = '42501';
  end if;

  if not exists (
       select 1 from stores s where lower(coalesce(s.owner_email, '')) = v_email
     )
     and not verafo_is_admin() then
    raise exception 'Not allowed: only a store owner or an admin may look up a buyer.' using errcode = '42501';
  end if;

  return v_email;
end;
$$;

-- ── 4. Cross-store verdict: aggregates only ─────────────────
-- Preserves the product promise: any number the merchant already knows
-- returns a risk answer. Returns NO phone, NO identity, NO store name,
-- NO order detail and NO vector.
--
-- VOLATILE because it writes the lookup log. 200 lookups per user per 24
-- hours, counted from `lookups` itself; over the limit it raises.
-- (The old signature returned first_seen as timestamptz, so the function has
-- to be dropped rather than replaced.)
drop function if exists buyer_network_lookup(text);

create or replace function buyer_network_lookup(p_phone text)
returns table (
  risk_score numeric,
  total_orders int,
  total_accepted int,
  total_refused int,
  store_count int,
  first_seen text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c_daily_limit constant int := 200;
  v_key text;
  v_email text;
  v_match text;
  v_recent int;
begin
  v_email := verafo_lookup_caller_email();

  v_key := verafo_normalize_phone(p_phone);
  if v_key is null then
    -- Not a complete Pakistani number: behave like "no such buyer" rather
    -- than confirming anything about the input.
    return;
  end if;

  if v_email is not null then
    select count(*)::int into v_recent
    from lookups l
    where lower(coalesce(l.owner_email, '')) = v_email
      and l.searched_at > now() - interval '24 hours';

    if v_recent >= c_daily_limit then
      raise exception 'Lookup limit reached: % lookups in the last 24 hours. Try again later.', c_daily_limit
        using errcode = '53400';
    end if;
  end if;

  -- The stored row's own spelling is the one logged, so lookups.buyer_phone
  -- keeps satisfying its foreign key to buyers(phone).
  select b.phone into v_match
  from buyers b
  where verafo_phone_key(b.phone) = v_key
  limit 1;

  if v_match is null then
    return;   -- unknown number: nothing to log, nothing to return
  end if;

  if v_email is not null then
    insert into lookups (buyer_phone, owner_email) values (v_match, v_email);
  end if;

  return query
    select
      b.risk_score,
      coalesce(b.total_orders, 0)::int,
      coalesce(b.total_accepted, 0)::int,
      coalesce(b.total_refused, 0)::int,
      (select count(distinct o.store_id)::int
         from orders o
        where verafo_phone_key(o.buyer_phone) = v_key)::int,
      -- Month only: enough for "known since", not a delivery fingerprint.
      to_char(b.first_seen, 'YYYY-MM')
    from buyers b
    where b.phone = v_match;
end;
$$;

-- ── 5. Similar buyers: no identities, no vector ─────────────
-- Same caller rule as buyer_network_lookup. The embedding never leaves
-- Postgres and the result has no phone column.
--
-- search_path note: this is the one function that names the `vector` type and
-- the `<=>` operator. On a hosted Supabase project pgvector may live in the
-- `extensions` schema, so that schema is on the path here (a schema that does
-- not exist is simply ignored, so this is also correct when vector is in
-- public).
drop function if exists similar_buyers_by_phone(text, int);

create or replace function similar_buyers_by_phone(p_phone text, p_limit int default 5)
returns table (
  similarity real,
  risk_score numeric,
  total_orders int,
  total_refused int
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_key text;
  v_me vector(1536);
begin
  perform verafo_lookup_caller_email();

  v_key := verafo_normalize_phone(p_phone);
  if v_key is null then
    return;
  end if;

  select b.embedding into v_me
  from buyers b
  where verafo_phone_key(b.phone) = v_key
    and b.embedding is not null
  limit 1;

  if v_me is null then
    return;
  end if;

  return query
    select
      (b.embedding <=> v_me)::real,
      b.risk_score,
      coalesce(b.total_orders, 0)::int,
      coalesce(b.total_refused, 0)::int
    from buyers b
    where b.embedding is not null
      and verafo_phone_key(b.phone) <> v_key
    order by b.embedding <=> v_me
    limit greatest(1, least(10, coalesce(p_limit, 5)));
end;
$$;

-- ── 6. Grants: least privilege ──────────────────────────────
-- The service role already has full access and does not need a grant.
-- anon gets nothing: a lookup needs a signed-in owner or admin.
revoke all on function verafo_phone_key(text) from public, anon;
revoke all on function verafo_normalize_phone(text) from public, anon;
revoke all on function verafo_lookup_caller_email() from public, anon, authenticated;
revoke all on function buyer_network_lookup(text) from public, anon;
revoke all on function similar_buyers_by_phone(text, int) from public, anon;

-- verafo_normalize_phone is called by the stage-C buyers policy, which runs
-- with the caller's privileges, so authenticated must be able to execute it.
-- It is a pure function of its input (no table is read, nothing is returned
-- but a validation of the number the caller typed), and it calls
-- verafo_phone_key(), which therefore needs the same grant.
grant execute on function verafo_phone_key(text) to authenticated;
grant execute on function verafo_normalize_phone(text) to authenticated;
grant execute on function buyer_network_lookup(text) to authenticated;
grant execute on function similar_buyers_by_phone(text, int) to authenticated;

-- NO policy change and NO revoke of the legacy find_similar_buyers in this
-- stage. It stays callable so the CURRENTLY DEPLOYED frontend and edge
-- function keep working until Stage C.

commit;

-- ============================================================
-- ROLLBACK (safe: nothing else depends on these yet)
-- ============================================================
-- begin;
-- drop function if exists buyer_network_lookup(text);
-- drop function if exists similar_buyers_by_phone(text, int);
-- drop function if exists verafo_lookup_caller_email();
-- drop function if exists verafo_normalize_phone(text);
-- drop function if exists verafo_phone_key(text);
-- commit;
