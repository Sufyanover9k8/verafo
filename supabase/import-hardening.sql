-- ============================================================================
-- Import hardening + phone identity + Shopify backfill state
--
-- Fixes four classes of problem found in the bulk-import audit:
--   1. Re-importing a CSV duplicated every order (no idempotency key).
--   2. Buyer identity split across phone formats (0300…, +92300…, 300…),
--      fragmenting the network score for the same person.
--   3. `buyers` was writable by any signed-in user (score poisoning).
--   4. Nowhere to store a resumable Shopify backfill cursor.
--
-- Safe to run on a live database: additive only, no rows are deleted except
-- the duplicate buyer identities that are merged in step 3.
-- ============================================================================

-- 1. Idempotent imports ------------------------------------------------------
-- Orders keep `order_reference` for the merchant's own reference (it is not
-- unique in existing data). `import_ref` is the importer's private dedupe key,
-- so a re-import of the same file becomes a no-op instead of a duplicate.
-- The index must NOT be partial: PostgREST's ON CONFLICT (store_id, import_ref)
-- can only infer an unconditional unique index. Existing rows have NULL here,
-- and NULLs are distinct, so they never collide.
alter table public.orders add column if not exists import_ref text;

create unique index if not exists orders_store_import_ref_key
  on public.orders (store_id, import_ref);

comment on column public.orders.import_ref is
  'Stable per-store key for a bulk-imported row; unique so re-imports do not duplicate.';

-- 2. Canonical phone numbers -------------------------------------------------
-- One canonical form per human: +92XXXXXXXXXX for Pakistani mobiles, +<digits>
-- for international numbers. Must match canonicalPhone() in src/lib/format.ts.
create or replace function public.canonical_phone(p text)
returns text
language plpgsql
immutable
as $$
declare
  d text;
  had_plus boolean;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '[^0-9+]', '', 'g');
  if d = '' then return p; end if;

  had_plus := left(d, 1) = '+';
  d := replace(d, '+', '');

  if left(d, 4) = '0092' then
    d := substring(d from 3);
  end if;

  if left(d, 2) = '92' and length(d) >= 11 then
    d := '0' || substring(d from 3);
  elsif (not had_plus) and length(d) = 10 and left(d, 1) = '3' then
    d := '0' || d;
  end if;

  if length(d) = 11 and d ~ '^03[0-9]{9}$' then
    return '+92' || substring(d from 2);
  end if;

  if had_plus and length(d) >= 8 then
    return '+' || d;
  end if;

  return d;
end $$;

-- Enforce it on both write paths, whoever writes.
create or replace function public.canonicalize_buyer_phone()
returns trigger language plpgsql as $$
begin
  new.phone := public.canonical_phone(new.phone);
  return new;
end $$;

create or replace function public.canonicalize_order_phone()
returns trigger language plpgsql as $$
begin
  new.buyer_phone := public.canonical_phone(new.buyer_phone);
  return new;
end $$;

drop trigger if exists buyers_canonical_phone on public.buyers;
create trigger buyers_canonical_phone
  before insert or update of phone on public.buyers
  for each row execute function public.canonicalize_buyer_phone();

drop trigger if exists orders_canonical_phone on public.orders;
create trigger orders_canonical_phone
  before insert or update of buyer_phone on public.orders
  for each row execute function public.canonicalize_order_phone();

-- 3. Merge the split identities already in the data ---------------------------
-- orders / lookups / chats hold a plain FK to buyers(phone), so the canonical
-- buyer row has to exist before the references can move, and the old rows can
-- only be dropped once nothing points at them.
do $$
declare
  moved integer;
  merged integer;
begin
  insert into public.buyers (phone)
  select distinct public.canonical_phone(phone)
    from public.buyers
   where public.canonical_phone(phone) is distinct from phone
  on conflict (phone) do nothing;

  update public.orders
     set buyer_phone = public.canonical_phone(buyer_phone)
   where buyer_phone is not null
     and public.canonical_phone(buyer_phone) is distinct from buyer_phone;
  get diagnostics moved = row_count;

  update public.lookups
     set buyer_phone = public.canonical_phone(buyer_phone)
   where buyer_phone is not null
     and public.canonical_phone(buyer_phone) is distinct from buyer_phone;

  update public.chats
     set phone = public.canonical_phone(phone)
   where phone is not null
     and public.canonical_phone(phone) is distinct from phone;

  delete from public.buyers
   where public.canonical_phone(phone) is distinct from phone;
  get diagnostics merged = row_count;

  raise notice 'canonical phone: moved % orders, merged % duplicate buyers', moved, merged;
end $$;

-- Rescore everyone whose identity changed.
select public.recompute_buyer(phone) from public.buyers where phone is not null;

-- 4. Close the buyer write hole ----------------------------------------------
-- These two policies let any authenticated user insert or update ANY buyer row,
-- including risk_score and total_refused — i.e. poison the shared network.
-- The app only ever inserts a stub (phone only), which the remaining
-- "buyers insert stub" policy already allows, and totals are written by the
-- SECURITY DEFINER recompute trigger.
drop policy if exists "authenticated write buyers" on public.buyers;
drop policy if exists "authenticated update buyers" on public.buyers;

-- 5. Resumable Shopify backfill state ---------------------------------------
-- The Shopify app runs on serverless hosts, so a long history import cannot
-- live inside one request. Each invocation advances a row here, which also
-- makes the import resumable after a deploy or a timeout.
create table if not exists public.shopify_sync_runs (
  id uuid primary key default gen_random_uuid(),
  shop text not null,
  store_id uuid not null,
  status text not null default 'running',   -- running | done | failed
  cursor text,
  since timestamptz not null,
  fetched integer not null default 0,
  imported integer not null default 0,
  skipped integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shopify_sync_runs_shop_idx
  on public.shopify_sync_runs (shop, started_at desc);

alter table public.shopify_sync_runs enable row level security;
-- No policies: only the service role (the Shopify app) may touch this table.
