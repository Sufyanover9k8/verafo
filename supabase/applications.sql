-- Applications from the public "Join Verafo" form on verafo.com.
--
-- The site is static, so the form posts straight to the REST API with the
-- publishable key. Anon may only INSERT; nobody but an admin may read a row
-- back. The whole submission is kept in `payload` so a future field never needs
-- a migration, with the two columns an admin actually scans generated from it.

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text,
  email text generated always as (nullif(payload ->> 'email', '')) stored,
  store text generated always as (nullif(payload ->> 'store', '')) stored,
  payload jsonb not null,
  handled boolean not null default false,
  handled_note text
);

create index if not exists applications_created_at_idx
  on public.applications (created_at desc);

alter table public.applications enable row level security;

revoke all on public.applications from anon, authenticated;
grant insert on public.applications to anon, authenticated;
grant select, update, delete on public.applications to authenticated;

drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications
  for insert to anon, authenticated
  with check (true);

drop policy if exists applications_admin_read on public.applications;
create policy applications_admin_read on public.applications
  for select to authenticated
  using (public.verafo_is_admin());

drop policy if exists applications_admin_write on public.applications;
create policy applications_admin_write on public.applications
  for update to authenticated
  using (public.verafo_is_admin())
  with check (public.verafo_is_admin());

comment on table public.applications is
  'Onboarding applications submitted from verafo.com. Insert is open to the publishable key; reading is admin-only.';
