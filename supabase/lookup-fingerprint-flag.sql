-- ============================================================
-- Fingerprint presence on Buyer Lookup
--
-- The badge in "Ask Verafo about this buyer" read `buyer.embedding`, but the
-- page has not received an embedding since Buyer Lookup was hardened: the
-- lookup builds its buyer from `buyer_network_lookup`, which deliberately
-- returns no vector, and the page then hard-coded `embedding: null`. The badge
-- was therefore ALWAYS "no fingerprint yet", and pressing "Refresh fingerprint"
-- re-ran the same lookup, so it could never change. The badge was reporting a
-- constant, not the buyer's state.
--
-- This adds `has_fingerprint` — a boolean about the vector, never the vector.
-- It reveals nothing a caller could not already infer (they hold the number),
-- and it does not widen what the function returns beyond a flag.
--
-- Run in the Supabase SQL editor, after buyer-privacy-stage-a.sql.
-- Idempotent: safe to run more than once.
-- ============================================================

begin;

/*
 * Postgres will not change a function's OUT columns with CREATE OR REPLACE, so
 * the old signature is dropped first. Both dependent functions are re-created
 * below, inside this transaction, so there is no window where one is missing.
 */
drop function if exists buyer_network_lookup(text);

create or replace function buyer_network_lookup(p_phone text)
returns table (
  risk_score numeric,
  total_orders int,
  total_accepted int,
  total_refused int,
  store_count int,
  first_seen text,
  -- TRUE when the buyer has an AI fingerprint stored. The vector itself is
  -- never returned.
  has_fingerprint boolean
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

  select b.phone into v_match
  from buyers b
  where verafo_phone_key(b.phone) = v_key
  limit 1;

  if v_match is null then
    return;
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
      to_char(b.first_seen, 'YYYY-MM'),
      -- A flag, never the vector: is there a fingerprint to draw on?
      (b.embedding is not null)
    from buyers b
    where b.phone = v_match;
end;
$$;

-- Same ACL the hardened version had: anon holds the key that ships in the
-- browser, so it must not be able to call this.
revoke all on function buyer_network_lookup(text) from public, anon;
grant execute on function buyer_network_lookup(text) to authenticated;

commit;
