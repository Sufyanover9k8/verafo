-- ============================================================
-- Verafo — shared KPIs + store search (dashboard & command palette)
-- Run after admin-dashboard.sql.
-- ============================================================

-- Network-wide headline KPIs in a single call (dashboard hero stats).
-- "today" uses server (UTC) date; orders counted regardless of outcome.
create or replace function network_kpis()
returns table (
  stores int,
  buyers int,
  orders int,
  pending_orders int,
  today_orders int,
  today_revenue numeric,
  week_revenue numeric
)
language sql
stable
as $$
  select
    (select count(*)::int from stores),
    (select count(*)::int from buyers),
    (select count(*)::int from orders),
    (select count(*)::int from outcomes where status = 'pending'),
    (select count(*)::int from orders where ordered_at >= current_date),
    (select coalesce(sum(price * quantity), 0)::numeric from orders where ordered_at >= current_date),
    (select coalesce(sum(price * quantity), 0)::numeric from orders where ordered_at >= current_date - 6)
$$;

-- Typeahead store search for the command palette: matches name or Shopify
-- domain, most-recently-active first.
create or replace function search_stores(p_query text, p_limit int default 8)
returns table (id uuid, name text, shopify_domain text, last_order_at timestamptz)
language sql
stable
as $$
  select s.id, s.name, s.shopify_domain, max(o.ordered_at) as last_order_at
  from stores s
  left join orders o on o.store_id = s.id
  where s.name ilike '%' || p_query || '%'
     or s.shopify_domain ilike '%' || p_query || '%'
  group by s.id, s.name, s.shopify_domain
  order by max(o.ordered_at) desc nulls last, s.name
  limit p_limit;
$$;

-- Keep chats.updated_at fresh whenever a message is posted.
create or replace function touch_chat_updated_at()
returns trigger
language plpgsql
as $$
begin
  update chats set updated_at = now() where id = new.chat_id;
  return new;
end;
$$;

drop trigger if exists trg_chat_touch on chat_messages;
create trigger trg_chat_touch
after insert on chat_messages
for each row execute function touch_chat_updated_at();

-- Hot paths used by the RPCs above + recent lookups / dashboards.
create index if not exists orders_ordered_at_idx on orders (ordered_at desc);
create index if not exists lookups_buyer_phone_idx on lookups (buyer_phone);

grant execute on function network_kpis() to anon, authenticated, service_role;
grant execute on function search_stores(text, int) to anon, authenticated, service_role;
