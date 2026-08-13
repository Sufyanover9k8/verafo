-- ============================================================
-- Verafo x Shopify — store linkage + idempotent order ingestion
-- Run this in the Supabase SQL editor (after schema.sql)
-- ============================================================

-- Link a Verafo store row to the Shopify shop domain that owns it.
-- The Shopify app creates/updates this row lazily on install/first webhook.
alter table stores add column if not exists shopify_domain text;

create unique index if not exists stores_shopify_domain_key
  on stores (shopify_domain)
  where shopify_domain is not null;

-- Idempotent ingestion: Shopify webhooks can retry, so each Shopify order id
-- maps to at most one Verafo order row. Upserts use this column as the key.
alter table orders add column if not exists shopify_order_id text;

create unique index if not exists orders_shopify_order_id_key
  on orders (shopify_order_id)
  where shopify_order_id is not null;

-- Helper: upsert the Verafo store for a shop domain and return its id.
create or replace function upsert_store_for_shop(p_domain text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into stores (name, shopify_domain)
  values (p_domain, p_domain)
  on conflict (shopify_domain) where shopify_domain is not null
  do update set name = excluded.name
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function upsert_store_for_shop(text) to anon, service_role;
