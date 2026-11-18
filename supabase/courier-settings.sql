-- ============================================================================
-- Courier settings (non-secret) + the columns the courier import writes.
--
-- Merchants tell us which courier they use and which of its APIs we should
-- call once the integration ships. No credential of any kind is stored here:
-- this table holds a provider name and an API label only. Anything secret
-- (tokens, API keys) must live in Supabase secrets / Vault, never in a row a
-- browser can read.
-- ============================================================================

create table if not exists public.store_courier_settings (
  store_id uuid primary key references public.stores(id) on delete cascade,
  courier_name text not null,
  /** Free-text API label, e.g. "CodShipmentAPI v2". Never a key. */
  api_name text,
  /** Optional link to the courier's API docs, for us and for support. */
  api_docs_url text,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.store_courier_settings enable row level security;

drop policy if exists "courier settings read" on public.store_courier_settings;
create policy "courier settings read" on public.store_courier_settings
  for select to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_id
        and (
          lower(coalesce(s.owner_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          or public.verafo_is_admin()
        )
    )
  );

drop policy if exists "courier settings write" on public.store_courier_settings;
create policy "courier settings write" on public.store_courier_settings
  for insert to authenticated
  with check (
    exists (
      select 1 from public.stores s
      where s.id = store_id
        and (
          lower(coalesce(s.owner_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          or public.verafo_is_admin()
        )
    )
  );

drop policy if exists "courier settings update" on public.store_courier_settings;
create policy "courier settings update" on public.store_courier_settings
  for update to authenticated
  using (
    exists (
      select 1 from public.stores s
      where s.id = store_id
        and (
          lower(coalesce(s.owner_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          or public.verafo_is_admin()
        )
    )
  )
  with check (
    exists (
      select 1 from public.stores s
      where s.id = store_id
        and (
          lower(coalesce(s.owner_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
          or public.verafo_is_admin()
        )
    )
  );

-- The courier importer matches rows to orders by these, so make the lookups cheap.
create index if not exists orders_store_tracking_idx
  on public.orders (store_id, courier_tracking_number)
  where courier_tracking_number is not null;
