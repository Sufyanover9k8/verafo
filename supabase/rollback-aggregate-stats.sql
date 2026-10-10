-- ============================================================
-- ROLLBACK — AGGREGATE STATS (supabase/aggregate-stats-migration.sql)
--
-- WHEN TO USE
--   ONLY if the hardening breaks the edge function and you must restore
--   service now. Rolling back here RE-OPENS two things on purpose:
--
--   ⚠️⚠️⚠️  1. verafo_buyer_ranking() goes back to ranking EVERY buyer on the
--           network instead of only the caller's stores, and its old
--           (text, int, int) signature comes back — so the deployed edge
--           function must be rolled back with it.
--   ⚠️⚠️⚠️  2. verafo_aggregate_stats() goes back to returning small buckets
--           (no 3-store / 10-order floor) AND to returning refusal_reason
--           FREE TEXT, which can contain a name, an address or a phone
--           number.
--
--   This file exists so recovery is possible, not because that state is
--   acceptable. Re-apply aggregate-stats-migration.sql as soon as you can.
-- ============================================================

begin;

-- ── Old verafo_aggregate_stats: no floor, raw reason text ───
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
          case when s.reason_raw = '' then 'No reason recorded'
               else s.reason_raw end
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
  order by count(*) desc
  limit 200;
$$;

revoke all on function verafo_aggregate_stats(text, int) from public, anon;
grant execute on function verafo_aggregate_stats(text, int) to authenticated;

-- ── Old verafo_buyer_ranking: network-wide, (text, int, int) ─
drop function if exists verafo_buyer_ranking(uuid[], text, int, int);

create or replace function verafo_buyer_ranking(
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
    where o.ordered_at is null
       or o.ordered_at >= (now() - make_interval(days => greatest(1, least(365, coalesce(p_days, 90)))))
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

revoke all on function verafo_buyer_ranking(text, int, int) from public, anon;
grant execute on function verafo_buyer_ranking(text, int, int) to authenticated;

commit;

-- REMINDER: the edge function must be rolled back to the version that calls
-- verafo_buyer_ranking without p_store_ids, or toolTopBuyers will error.
