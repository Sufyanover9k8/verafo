-- The Workflow board's wires.
--
-- One row per automated connection between two boards. A missing row means the
-- wire follows `store_call_settings.auto_call`, which is how every store behaved
-- before the board existed, so no backfill is needed.
--
--   call_dial         Orders        → Call queue   queue risky orders and dial them
--   auto_accept       Orders        → To deliver   approve orders below the risk line
--   call_ship         Call queue    → To deliver   a confirmed call approves the order
--   call_refuse       Call queue    → Declined     a cancelled call rejects the order
--   courier_delivered To deliver    → Delivered    the courier reports delivery
--   courier_returned  To deliver    → Declined     the courier reports a refusal
--
-- `call_dial` is mirrored into `store_call_settings.auto_call` by the app, because
-- that is the switch the "Automate calls" button and the call-queue cron read.
create table if not exists public.workflow_automation (
  store_id uuid not null references public.stores(id) on delete cascade,
  edge text not null check (edge in (
    'call_dial', 'auto_accept', 'call_ship', 'call_refuse', 'courier_delivered', 'courier_returned'
  )),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (store_id, edge)
);

-- Older installs were created with the five-edge check.
alter table public.workflow_automation drop constraint if exists workflow_automation_edge_check;
alter table public.workflow_automation add constraint workflow_automation_edge_check check (edge in (
  'call_dial', 'auto_accept', 'call_ship', 'call_refuse', 'courier_delivered', 'courier_returned'
));

alter table public.workflow_automation enable row level security;

drop policy if exists workflow_automation_read on public.workflow_automation;
create policy workflow_automation_read on public.workflow_automation
  for select using (verafo_is_admin() or store_id in (select verafo_my_store_ids()));

drop policy if exists workflow_automation_write on public.workflow_automation;
create policy workflow_automation_write on public.workflow_automation
  for all using (verafo_is_admin() or store_id in (select verafo_my_store_ids()))
  with check (verafo_is_admin() or store_id in (select verafo_my_store_ids()));
