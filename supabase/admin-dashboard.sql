-- ============================================================
-- Verafo — Admin & per-store dashboards
-- Run in the Supabase SQL editor (after schema.sql).
-- ============================================================

-- Aggregated metrics per store. One row per onboarded store.
create or replace function store_overview()
returns table (
  id uuid,
  name text,
  shopify_domain text,
  owner_email text,
  created_at timestamptz,
  orders int,
  accepted int,
  refused int,
  pending int,
  revenue numeric,          -- gross order value sum(price * quantity)
  buyers int,               -- distinct buyer phones ordering from this store
  avg_order_value numeric,
  last_order_at timestamptz
)
language sql
stable
as $$
  select
    s.id,
    s.name,
    s.shopify_domain,
    s.owner_email,
    s.created_at,
    count(o.id)::int as orders,
    count(o.id) filter (where ou.status = 'accepted')::int as accepted,
    count(o.id) filter (where ou.status = 'refused')::int as refused,
    count(o.id) filter (where ou.status is null or ou.status = 'pending')::int as pending,
    coalesce(sum(o.price * o.quantity), 0) as revenue,
    count(distinct o.buyer_phone)::int as buyers,
    round(coalesce(sum(o.price * o.quantity) / nullif(count(o.id), 0), 0), 0) as avg_order_value,
    max(o.ordered_at) as last_order_at
  from stores s
  left join orders o on o.store_id = s.id
  left join outcomes ou on ou.order_id = o.id
  group by s.id, s.name, s.shopify_domain, s.owner_email, s.created_at
  order by s.created_at;
$$;

-- Daily gross sales + order count for the last N days.
-- p_store_id null (default) => network-wide. Sales = order amount regardless of outcome.
create or replace function daily_sales(p_store_id uuid default null, p_days int default 14)
returns table (day date, orders int, revenue numeric)
language sql
stable
as $$
  select
    d.day,
    count(o.id)::int as orders,
    coalesce(sum(o.price * o.quantity), 0) as revenue
  from generate_series(current_date - (p_days - 1), current_date, interval '1 day') as d(day)
  left join orders o
    on o.ordered_at::date = d.day
   and (p_store_id is null or o.store_id = p_store_id)
  group by d.day
  order by d.day;
$$;

grant execute on function store_overview() to anon, authenticated, service_role;
grant execute on function daily_sales(uuid, int) to anon, authenticated, service_role;