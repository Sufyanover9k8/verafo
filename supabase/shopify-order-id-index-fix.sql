-- ============================================================
-- FIX: Shopify orders never reached the dashboard
--
-- THE DEFECT. `supabase/shopify-migration.sql` created the idempotency key as a
-- PARTIAL unique index:
--
--   create unique index orders_shopify_order_id_key
--     on orders (shopify_order_id) where shopify_order_id is not null;
--
-- The Shopify app upserts with supabase-js:
--
--   .upsert({ ... }, { onConflict: "shopify_order_id" })
--
-- which PostgREST compiles to `ON CONFLICT ("shopify_order_id")` — with no WHERE
-- predicate. Postgres can only infer a partial index when the statement carries a
-- matching predicate, so it refuses before touching a row:
--
--   42P10  there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- Every orders/create webhook therefore threw, the route answered 500, Shopify
-- retried, and the order book stayed empty. No order has ever been ingested.
-- Reproduced against the live project on 18 Oct 2026:
--
--   POST /rest/v1/orders?on_conflict=shopify_order_id  →  400 42P10
--
-- THE FIX. A full unique index. Postgres treats NULLs as distinct in a unique
-- index, so any number of rows may still have `shopify_order_id` NULL — the
-- predicate was never doing useful work, only blocking the inference.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

-- Refuse to proceed if duplicates already exist; the index would fail halfway.
do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes from (
    select shopify_order_id
    from orders
    where shopify_order_id is not null
    group by shopify_order_id
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'Cannot create the unique index: % duplicated shopify_order_id value(s) exist. Resolve them first.',
      v_dupes;
  end if;
end;
$$;

drop index if exists orders_shopify_order_id_key;

create unique index if not exists orders_shopify_order_id_key
  on orders (shopify_order_id);

-- Verify: indexdef must NOT contain a WHERE clause.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'orders'
  and indexname = 'orders_shopify_order_id_key';

-- ── After running this ──────────────────────────────────────
-- 1. Open the Verafo app in Shopify admin and press **Sync** on the home page.
--    It pulls the 50 most recent orders and re-ingests them. Webhooks Shopify
--    already retried will also start succeeding on their next attempt.
-- 2. Confirm rows arrive:
--    select count(*) filter (where shopify_order_id is not null) as from_shopify,
--           count(*) as total
--    from orders;
