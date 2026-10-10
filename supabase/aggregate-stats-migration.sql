-- ============================================================
-- Verafo — aggregate statistics for network intelligence
--   [SUPPORTS R1: cross-store aggregate intelligence is ALLOWED]
--
-- WHY THIS EXISTS
-- The `verafo-ai` edge function runs on the SERVICE ROLE key, so RLS cannot
-- separate merchants inside it. Its aggregate tools used to compute their
-- figures by reading the `orders` table raw. That is the wrong shape: it
-- pulled individual order rows (and therefore buyer phones, cities and
-- addresses) into the function just to produce a count.
--
-- This function computes the aggregates in the database and returns ONLY
-- statistics. No phone number, no address, no store identity, no order id,
-- no per-order row ever leaves Postgres.
--
-- WHAT IT RETURNS
--   bucket        the group label - a city, product, category, reason or week
--   orders        number of orders in the bucket
--   buyers        distinct buyers in the bucket (a COUNT, never the numbers)
--   value         sum of price * quantity
--   accepted      resolved as accepted
--   refused       resolved as refused
--   pending       no outcome yet, or still pending
--   refusal_rate  refused / (accepted + refused), NULL when nothing resolved
--
-- SMALL-BUCKET FLOOR (hardening pass)
-- A bucket is returned ONLY when it covers at least 3 DISTINCT stores and at
-- least 10 orders. A bucket covering one store is that store's private book,
-- not network intelligence, and a two-order bucket can be de-anonymised by
-- anyone who knows the two orders. `store_id` is part of the working set so
-- the floor can be counted, and is never returned.
--
-- NOTE ON PRIVACY
-- `buyers` is a COUNT. The function never returns a phone number, so it
-- cannot be used to enumerate or contact anyone. This is what makes it safe
-- for a network-wide aggregate while the `orders` table is not.
--
-- SAFE TO RUN: creates two functions and touches no policy. The whole file is
-- one transaction, so the ranking function is never missing for a moment
-- (it is dropped and recreated to change its signature).
-- Rollback at the bottom.
--
-- DEPENDENCY: supabase/schema.sql (orders, outcomes) and the Supabase roles
-- anon / authenticated / service_role.
-- ============================================================

begin;

create or replace function verafo_aggregate_stats(
  p_dimension text,
  p_days int default 30
)
returns table (
  bucket text,
  orders int,
  buyers int,
  value numeric,
  accepted int,
  refused int,
  pending int,
  refusal_rate numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with scoped as (
    select
      o.id,
      o.buyer_phone,
      o.price,
      o.quantity,
      o.ordered_at,
      -- Needed for the 3-distinct-store floor below. Never returned.
      o.store_id,
      lower(coalesce(o.city, ''))                                  as city_raw,
      coalesce(nullif(o.product_name, ''), nullif(o.product_category, ''), '') as product_raw,
      lower(coalesce(o.product_category, ''))                      as category_raw,
      coalesce(ou.status, 'pending')                               as status,
      coalesce(ou.refusal_reason, '')                              as reason_raw
    from orders o
    left join outcomes ou on ou.order_id = o.id
    where o.ordered_at is null
       or o.ordered_at >= (now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 30)))))
  ),
  labelled as (
    select
      s.*,
      case lower(coalesce(p_dimension, 'city'))
        when 'city' then
          case when s.city_raw = '' then 'Unknown city'
               else initcap(s.city_raw) end
        when 'product' then
          case when s.product_raw = '' then 'Unknown product'
               else s.product_raw end
        when 'category' then
          case when s.category_raw = '' then 'Unknown category'
               else initcap(s.category_raw) end
        when 'reason' then
          -- FIXED VOCABULARY. refusal_reason is free text (Shopify's
          -- cancel_reason, or anything a merchant typed), so it can carry a
          -- name, an address or a phone number. Only these labels are ever
          -- returned; anything else becomes 'Other'.
          case lower(btrim(s.reason_raw))
            when 'customer'  then 'Customer cancelled'
            when 'fraud'     then 'Fraud suspected'
            when 'inventory' then 'Out of stock'
            when 'declined'  then 'Payment declined'
            when 'staff'     then 'Staff error'
            when 'other'     then 'Other'
            when ''          then 'No reason recorded'
            else 'Other'
          end
        when 'week' then
          to_char(date_trunc('week', coalesce(s.ordered_at, now())), 'IYYY-"W"IW')
        else 'All orders'
      end as bucket_label
    from scoped s
  )
  select
    l.bucket_label                                                            as bucket,
    count(*)::int                                                             as orders,
    count(distinct l.buyer_phone)::int                                        as buyers,
    coalesce(sum(coalesce(l.price, 0) * coalesce(l.quantity, 1)), 0)          as value,
    count(*) filter (where l.status = 'accepted')::int                         as accepted,
    count(*) filter (where l.status = 'refused')::int                          as refused,
    count(*) filter (where l.status not in ('accepted', 'refused'))::int       as pending,
    case
      when count(*) filter (where l.status in ('accepted', 'refused')) = 0 then null
      else round(
        (count(*) filter (where l.status = 'refused'))::numeric
        / (count(*) filter (where l.status in ('accepted', 'refused')))::numeric,
        4)
    end                                                                       as refusal_rate
  from labelled l
  group by l.bucket_label
  -- Small-bucket floor: 3 distinct stores AND 10 orders, or the bucket is not
  -- returned at all. count(*) here is the returned `orders` column.
  having count(distinct l.store_id) >= 3
     and count(*) >= 10
  order by count(*) desc
  limit 200;
$$;

-- Least privilege: signed-in merchants only. This is the function that makes
-- network-wide aggregate intelligence safe, so it must be reachable, but it
-- is never granted to anon.
revoke all on function verafo_aggregate_stats(text, int) from public, anon;
grant execute on function verafo_aggregate_stats(text, int) to authenticated;

-- ── Buyer ranking: MY stores only ───────────────────────────
-- "Who are my best buyers?" is an aggregate question, but the answer is a
-- list of people, and the `buyers` table is keyed by phone number. Returning
-- phone numbers network-wide would be the same leak we are closing.
--
-- So this returns a RANK and a MASKED label, never a phone number and never
-- an id. The label is the last 4 digits only, which lets a merchant recognise
-- a buyer they already deal with without telling anyone who they are.
--
-- HARDENING PASS: the caller must name the stores it is asking about, and
-- ONLY buyers of those stores are ranked. An empty or null array ranks
-- nothing - it never falls back to the whole network.
--
-- NOTE ON THE CALLER: p_store_ids is a parameter, so no signed-in user may
-- call this with an arbitrary id. It is granted to the service role only (the
-- verafo-ai edge function, which passes the store ids it resolved from the
-- caller's own stores). If a browser caller is ever needed, add an
-- own-stores check inside the function BEFORE re-granting it.
drop function if exists verafo_buyer_ranking(text, int, int);

create or replace function verafo_buyer_ranking(
  p_store_ids uuid[] default '{}'::uuid[],
  p_metric text default 'orders',
  p_limit int default 10,
  p_days int default 90
)
returns table (
  rank int,
  buyer_label text,
  orders int,
  accepted int,
  refused int,
  value numeric,
  risk_score numeric,
  store_count int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with scoped as (
    select
      o.buyer_phone,
      o.price,
      o.quantity,
      o.store_id,
      coalesce(ou.status, 'pending') as status
    from orders o
    left join outcomes ou on ou.order_id = o.id
    where o.store_id = any (coalesce(p_store_ids, '{}'::uuid[]))
      and (
        o.ordered_at is null
        or o.ordered_at >= (now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 90)))))
      )
  ),
  agg as (
    select
      s.buyer_phone,
      count(*)::int                                                          as orders,
      count(*) filter (where s.status = 'accepted')::int                      as accepted,
      count(*) filter (where s.status = 'refused')::int                       as refused,
      coalesce(sum(coalesce(s.price, 0) * coalesce(s.quantity, 1)), 0)        as value,
      count(distinct s.store_id)::int                                         as store_count
    from scoped s
    group by s.buyer_phone
  )
  select
    (row_number() over (
      order by
        case lower(coalesce(p_metric, 'orders'))
          when 'spend' then a.value
          when 'refusals' then a.refused::numeric
          when 'risk' then coalesce(b.risk_score, 0)
          else a.orders::numeric
        end desc
    ))::int                                                                   as rank,
    -- Last 4 digits only. No full number, no id.
    '····' || right(a.buyer_phone, 4)                                          as buyer_label,
    a.orders,
    a.accepted,
    a.refused,
    a.value,
    b.risk_score,
    a.store_count
  from agg a
  left join buyers b on b.phone = a.buyer_phone
  order by
    case lower(coalesce(p_metric, 'orders'))
      when 'spend' then a.value
      when 'refusals' then a.refused::numeric
      when 'risk' then coalesce(b.risk_score, 0)
      else a.orders::numeric
    end desc
  limit greatest(1, least(50, coalesce(p_limit, 10)));
$$;

-- Service role only: the store list is a parameter, so it must not be
-- callable by anon or authenticated.
revoke all on function verafo_buyer_ranking(uuid[], text, int, int) from public, anon, authenticated;
grant execute on function verafo_buyer_ranking(uuid[], text, int, int) to service_role;

commit;

-- ============================================================
-- ROLLBACK
-- ============================================================
-- drop function if exists verafo_aggregate_stats(text, int);
-- drop function if exists verafo_buyer_ranking(uuid[], text, int, int);
-- (the pre-hardening network-wide version, if it needs to come back:)
-- drop function if exists verafo_buyer_ranking(uuid[], text, int, int);
-- create function verafo_buyer_ranking(p_metric text default 'orders', p_limit int default 10, p_days int default 90) ...

