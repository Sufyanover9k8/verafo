-- ============================================================
-- Verafo — store profile extras (category, contact phone)
-- Run in the Supabase SQL editor (after schema.sql + admin-dashboard.sql)
-- ============================================================

alter table stores add column if not exists category text;
alter table stores add column if not exists contact_phone text;

-- Recreate store_overview() so the new profile fields flow through the RPC.
create or replace function store_overview()
returns table (
  id uuid,
  name text,
  shopify_domain text,
  owner_email text,
  created_at timestamptz,
  category text,
  contact_phone text,
  orders int,
  accepted int,
  refused int,
  pending int,
  revenue numeric,
  buyers int,
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
    s.category,
    s.contact_phone,
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
  group by s.id, s.name, s.shopify_domain, s.owner_email, s.created_at, s.category, s.contact_phone
  order by s.created_at;
$$;

grant execute on function store_overview() to anon, authenticated, service_role;