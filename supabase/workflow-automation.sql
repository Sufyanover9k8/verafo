-- The Workflow board's wires.
--
-- One row per automated connection between two boards. A missing row means the
-- wire is on, which is how every store behaved before the board existed, so no
-- backfill is needed. `call_dial` is mirrored into
-- `store_call_settings.auto_call` by the app, because that is the switch the
-- call-queue cron and the "Automate calls" button already read.
create table if not exists public.workflow_automation (
  store_id uuid not null references public.stores(id) on delete cascade,
  edge text not null check (edge in ('call_dial', 'call_ship', 'call_refuse', 'courier_delivered', 'courier_returned')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (store_id, edge)
);

alter table public.workflow_automation enable row level security;

drop policy if exists workflow_automation_read on public.workflow_automation;
create policy workflow_automation_read on public.workflow_automation
  for select using (verafo_is_admin() or store_id in (select verafo_my_store_ids()));

drop policy if exists workflow_automation_write on public.workflow_automation;
create policy workflow_automation_write on public.workflow_automation
  for all using (verafo_is_admin() or store_id in (select verafo_my_store_ids()))
  with check (verafo_is_admin() or store_id in (select verafo_my_store_ids()));
