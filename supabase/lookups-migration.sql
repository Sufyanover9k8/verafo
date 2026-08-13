-- Run this in the Supabase SQL editor if you already ran schema.sql before
-- the lookups table existed (otherwise just re-run schema.sql).

create table lookups (
  id uuid primary key default gen_random_uuid(),
  buyer_phone text references buyers(phone),
  searched_at timestamptz default now()
);

create index lookups_searched_at_idx on lookups (searched_at desc);

alter table lookups enable row level security;

create policy "demo anon lookups" on lookups for all to anon using (true) with check (true);

-- a little starter history so the Recent lookups panel isn't empty
insert into lookups (buyer_phone, searched_at) values
  ('+923459990000', now() - interval '26 minutes'),
  ('+923214445555', now() - interval '2 hours'),
  ('+923001112222', now() - interval '5 hours'),
  ('+923125556666', now() - interval '1 day');
