-- Verafo courier reconciliation
-- Run once in Supabase SQL Editor before deploying the frontend changes.
-- Keep order_reference non-unique: imports can contain duplicate Shopify references across stores.
alter table public.orders add column if not exists order_reference text;
alter table public.orders add column if not exists courier_tracking_number text;

create index if not exists orders_store_order_reference_idx
  on public.orders (store_id, order_reference)
  where order_reference is not null;

create index if not exists orders_courier_tracking_idx
  on public.orders (store_id, courier_tracking_number)
  where courier_tracking_number is not null;

notify pgrst, 'reload schema';
