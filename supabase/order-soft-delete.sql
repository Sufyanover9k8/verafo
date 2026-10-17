-- ============================================================
-- Hiding an order, without deleting it
--
-- WHY NOT `delete`. The order history is the training set for the risk model.
-- A merchant who removes an order because it was a test, a duplicate or a typo
-- must stop seeing it, but the row and its outcome have to survive: deleting
-- them would quietly shrink the data the model learns from, and the loss is
-- invisible — worse than a wrong number, because nobody can tell it happened.
--
-- So a removed order is HIDDEN: `deleted_at` is stamped and every product
-- surface skips it. Nothing is ever removed from `orders` or `outcomes`, and a
-- training export can select the full history whenever it needs to.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

alter table orders add column if not exists deleted_at timestamptz;
alter table orders add column if not exists deleted_by text;

comment on column orders.deleted_at is
  'Hidden from the product when set. The row is kept for model training; nothing is deleted.';
comment on column orders.deleted_by is
  'Who hid it. Null when visible.';

-- Only the hidden minority is indexed; visible queries never pay for it.
create index if not exists orders_hidden_idx on orders (deleted_at) where deleted_at is not null;

-- ── Hide / restore ──────────────────────────────────────────
-- One function for both directions so the pair cannot drift apart. A merchant
-- may only touch their own store's orders; an admin may touch any.
create or replace function verafo_set_orders_hidden(p_ids uuid[], p_hidden boolean)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;

  update orders o
     set deleted_at = case when p_hidden then now() else null end,
         deleted_by = case when p_hidden then verafo_current_email() else null end
   where o.id = any(p_ids)
     and (
       verafo_is_admin()
       or exists (
         select 1 from stores s
          where s.id = o.store_id
            and lower(coalesce(s.owner_email, '')) = verafo_current_email()
       )
     );
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function verafo_set_orders_hidden(uuid[], boolean) from public, anon;
grant execute on function verafo_set_orders_hidden(uuid[], boolean) to authenticated;

-- ── Aggregates stop counting hidden orders ──────────────────
-- The app filters its own lists, but the headline numbers come from these
-- functions, and a merchant who hides an order and still sees it in "Orders ·
-- last 7 days" would rightly call that a bug. Bodies are otherwise unchanged.

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
    (select count(*)::int from orders where deleted_at is null),
    (select count(*)::int
       from outcomes ou
       join orders o on o.id = ou.order_id
      where ou.status = 'pending' and o.deleted_at is null),
    (select count(*)::int from orders where deleted_at is null and ordered_at >= current_date),
    (select coalesce(sum(price * quantity), 0)::numeric
       from orders where deleted_at is null and ordered_at >= current_date),
    (select coalesce(sum(price * quantity), 0)::numeric
       from orders where deleted_at is null and ordered_at >= current_date - 6)
$$;

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
   and o.deleted_at is null
  group by d.day
  order by d.day;
$$;

-- store_overview() is deliberately NOT touched here.
--
-- An earlier version of this file re-created it, and Postgres refused:
--   42P13 cannot change return type of existing function
-- because the deployed store_overview() returns `category` and `contact_phone`
-- on top of the columns declared in admin-dashboard.sql. Replacing it with the
-- older shape would have silently deleted two columns the Stores page reads, so
-- the honest choice is to leave the function alone. Consequence, admin-only: the
-- per-store counts on /stores are computed without a deleted_at filter, so a
-- hidden order still counts there. Every list a merchant sees does not.

-- Grants match the originals exactly: adding a filter must not change who may
-- call these.
grant execute on function network_kpis() to anon, authenticated, service_role;
grant execute on function daily_sales(uuid, int) to anon, authenticated, service_role;

-- ── What is deliberately NOT changed ────────────────────────
-- recompute_buyer() and the order/outcome triggers still read every order, so a
-- hidden order keeps teaching the model. That is the point of keeping it: a
-- refusal is a refusal whether or not the merchant wants to look at the row.
-- buyer risk scores are trained on the full history; only the lists and the
-- headline counts treat a hidden order as gone.

-- Ask PostgREST to pick up the new column and function immediately. Supabase
-- usually does this by itself; this makes it certain, so the app cannot sit
-- there reporting "not switched on" against a database that already is.
notify pgrst, 'reload schema';
