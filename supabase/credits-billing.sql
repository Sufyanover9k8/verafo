-- Plans, credit metering and per-store credit status.
--
-- Credit model (agreed with the merchant):
--   1 buyer check      = 1 credit
--   1 minute of a call = 1 credit (rounded up)
--   Free               = 100 credits a month, no overage
--   Standard           = PKR 6,999 -> 333 credits, extra credits PKR 21 each
--   Founder One        = PKR 12,499 -> 781 credits, extra credits PKR 16 each
-- Overage is billed through Shopify usage records, capped per plan.

create table if not exists public.plans (
  code text primary key,
  name text not null,
  price_pkr numeric(10, 2) not null default 0,
  included_credits integer not null default 0,
  overage_pkr_per_credit numeric(10, 2) not null default 0,
  overage_cap_credits integer not null default 0,
  trial_days integer not null default 0,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.plans (code, name, price_pkr, included_credits, overage_pkr_per_credit, overage_cap_credits, trial_days, sort_order)
values
  ('free',     'Free',        0,     100, 0,  0,   0, 1),
  ('standard', 'Standard',    6999,  333, 21, 333, 7, 2),
  ('founder',  'Founder One', 12499, 781, 16, 781, 45, 3)
on conflict (code) do update set
  name = excluded.name,
  price_pkr = excluded.price_pkr,
  included_credits = excluded.included_credits,
  overage_pkr_per_credit = excluded.overage_pkr_per_credit,
  overage_cap_credits = excluded.overage_cap_credits,
  trial_days = excluded.trial_days,
  sort_order = excluded.sort_order,
  updated_at = now();

alter table public.store_plans
  add column if not exists cycle_start date,
  add column if not exists cycle_end date,
  add column if not exists included_credits integer,
  add column if not exists overage_pkr_per_credit numeric(10, 2),
  add column if not exists overage_cap_credits integer,
  add column if not exists overage_billed_credits integer not null default 0,
  add column if not exists usage_line_item_id text,
  add column if not exists shop text,
  add column if not exists suspended boolean not null default false;

create table if not exists public.credit_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  kind text not null check (kind in ('check', 'call', 'adjust')),
  credits numeric(10, 2) not null,
  ref text,
  occurred_at timestamptz not null default now(),
  period date not null default ((now() at time zone 'utc')::date),
  billed_at timestamptz
);

create index if not exists credit_events_store_time on public.credit_events (store_id, occurred_at desc);
create index if not exists credit_events_unbilled on public.credit_events (store_id) where billed_at is null;

alter table public.credit_events enable row level security;

drop policy if exists credit_events_read on public.credit_events;
create policy credit_events_read on public.credit_events
  for select using (public.verafo_is_admin() or store_id in (select public.verafo_my_store_ids()));

-- Checks are logged by the dashboard; attribute them to the store that was open.
alter table public.lookups add column if not exists store_id uuid references public.stores(id) on delete set null;

/**
 * Resolve which store an owner's dashboard activity belongs to: the store the
 * row names, else the owner's first store. Returns null when they own none.
 */
create or replace function public.verafo_store_for_owner(p_owner text, p_store uuid)
returns uuid
language sql
security definer
set search_path = public
as $$
  select coalesce(
    p_store,
    (select s.id from public.stores s where s.owner_email = p_owner order by s.created_at asc limit 1)
  );
$$;

/** A check costs one credit. */
create or replace function public.verafo_credit_from_lookup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid;
begin
  if new.buyer_phone is null or new.buyer_phone = '' then
    return new;
  end if;
  v_store := public.verafo_store_for_owner(new.owner_email, new.store_id);
  if v_store is null then
    return new;
  end if;
  insert into public.credit_events (store_id, kind, credits, ref, occurred_at)
  values (v_store, 'check', 1, new.buyer_phone, coalesce(new.searched_at, now()));
  return new;
end;
$$;

drop trigger if exists credit_from_lookup on public.lookups;
create trigger credit_from_lookup
  after insert on public.lookups
  for each row execute function public.verafo_credit_from_lookup();

/** A call costs its talk time in minutes, rounded up. */
create or replace function public.verafo_credit_from_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.credit_events (store_id, kind, credits, ref, occurred_at)
  values (
    new.store_id,
    'call',
    ceil(greatest(coalesce(new.seconds, 0), 0)::numeric / 60),
    new.verification_id::text,
    coalesce(new.created_at, now())
  );
  return new;
end;
$$;

drop trigger if exists credit_from_call on public.call_usage;
create trigger credit_from_call
  after insert on public.call_usage
  for each row execute function public.verafo_credit_from_call();

/**
 * What a store may spend this month: the plan's included credits plus the
 * overage cap, minus everything used since the cycle began.
 */
create or replace function public.store_credit_status(p_store uuid)
returns table (
  plan_code text,
  plan_name text,
  status text,
  included_credits integer,
  overage_allowed integer,
  used_credits numeric,
  remaining_credits numeric,
  overage_credits numeric,
  overage_pkr_per_credit numeric,
  price_pkr numeric,
  cycle_start date,
  cycle_end date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.plans;
  v_row public.store_plans;
  v_start date := date_trunc('month', (now() at time zone 'utc'))::date;
  v_end date := (date_trunc('month', (now() at time zone 'utc')) + interval '1 month')::date;
  v_used numeric;
begin
  if not (public.verafo_is_admin() or p_store in (select public.verafo_my_store_ids())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_row from public.store_plans where store_id = p_store;
  select * into v_plan from public.plans where code = coalesce(nullif(v_row.plan_name, ''), 'free');
  if v_plan.code is null then
    select * into v_plan from public.plans where code = 'free';
  end if;

  select coalesce(sum(c.credits), 0) into v_used
  from public.credit_events c
  where c.store_id = p_store
    and c.occurred_at >= v_start
    and c.occurred_at < v_end;

  plan_code := v_plan.code;
  plan_name := v_plan.name;
  status := coalesce(v_row.status, 'active');
  included_credits := coalesce(nullif(v_row.included_credits, 0), v_plan.included_credits);
  overage_allowed := coalesce(v_row.overage_cap_credits, v_plan.overage_cap_credits);
  used_credits := v_used;
  remaining_credits := greatest(0, (included_credits + overage_allowed) - v_used);
  overage_credits := greatest(0, v_used - included_credits);
  overage_pkr_per_credit := coalesce(v_row.overage_pkr_per_credit, v_plan.overage_pkr_per_credit);
  price_pkr := v_plan.price_pkr;
  cycle_start := v_start;
  cycle_end := v_end;
  return next;
end;
$$;

/** Every store's plan row, created on demand so billing has somewhere to write. */
create or replace function public.verafo_ensure_store_plan(p_store uuid)
returns public.store_plans
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.store_plans;
begin
  select * into v_row from public.store_plans where store_id = p_store;
  if v_row.store_id is null then
    insert into public.store_plans (store_id, plan_name, status)
    values (p_store, 'free', 'active')
    returning * into v_row;
  end if;
  return v_row;
end;
$$;
