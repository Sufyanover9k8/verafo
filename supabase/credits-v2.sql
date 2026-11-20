-- Credits v2: packaged credits, then uncapped overage.
--
--   1 check      = 1 credit
--   1 call minute = 1 credit (rounded up)
--
--   Free        100 credits a month, no overage: work stops at zero.
--   Standard    100 credits packaged at PKR 6,999, then PKR 21 a credit with
--               no cap — the overage is real money on the next invoice.
--   Founder One 350 credits packaged at PKR 12,499, then PKR 16 a credit, also
--               uncapped, price locked.

alter table public.plans
  add column if not exists allow_overage boolean not null default false,
  add column if not exists usage_ceiling_pkr numeric(10, 2) not null default 0;

-- Per-store plan rows carry the same two facts, so the dashboard and the
-- billing sweep can read one row each without joining the plan table.
alter table public.store_plans
  add column if not exists allow_overage boolean not null default true,
  add column if not exists usage_ceiling_pkr numeric(10, 2) not null default 100000;

update public.store_plans set overage_cap_credits = 0 where plan_name in ('standard', 'founder');

update public.plans set
  included_credits = 100,
  overage_pkr_per_credit = 0,
  overage_cap_credits = 0,
  allow_overage = false,
  usage_ceiling_pkr = 0
where code = 'free';

update public.plans set
  price_pkr = 6999,
  included_credits = 100,
  overage_pkr_per_credit = 21,
  overage_cap_credits = 0,
  allow_overage = true,
  usage_ceiling_pkr = 100000,
  trial_days = 7
where code = 'standard';

update public.plans set
  price_pkr = 12499,
  included_credits = 350,
  overage_pkr_per_credit = 16,
  overage_cap_credits = 0,
  allow_overage = true,
  usage_ceiling_pkr = 100000,
  trial_days = 45
where code = 'founder';

-- The status shape changed (a cap became a boolean), so replace it outright.
drop function if exists public.store_credit_status(uuid);

create function public.store_credit_status(p_store uuid)
returns table (
  plan_code text,
  plan_name text,
  status text,
  included_credits integer,
  used_credits numeric,
  remaining_credits numeric,
  overage_credits numeric,
  overage_pkr_per_credit numeric,
  allow_overage boolean,
  usage_ceiling_pkr numeric,
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
  -- service-role callers (edge functions) have no auth context
  if auth.uid() is not null
     and not (public.verafo_is_admin() or p_store in (select public.verafo_my_store_ids())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select * into v_row from public.store_plans where store_id = p_store;
  select * into v_plan from public.plans where code = coalesce(nullif(v_row.plan_name, ''), 'free');
  if v_plan.code is null then
    select * into v_plan from public.plans where code = 'free';
  end if;

  select coalesce(sum(c.credits), 0) into v_used
  from public.credit_events c
  where c.store_id = p_store and c.occurred_at >= v_start and c.occurred_at < v_end;

  plan_code := v_plan.code;
  plan_name := v_plan.name;
  status := coalesce(v_row.status, 'active');
  included_credits := coalesce(nullif(v_row.included_credits, 0), v_plan.included_credits);
  used_credits := v_used;
  -- Packaged credits left. A paid plan keeps working past zero, so this is
  -- only a floor, not a limit: overage_credits is what gets billed.
  remaining_credits := greatest(0, included_credits - v_used);
  overage_credits := greatest(0, v_used - included_credits);
  overage_pkr_per_credit := coalesce(v_row.overage_pkr_per_credit, v_plan.overage_pkr_per_credit);
  allow_overage := v_plan.allow_overage;
  usage_ceiling_pkr := v_plan.usage_ceiling_pkr;
  price_pkr := v_plan.price_pkr;
  cycle_start := v_start;
  cycle_end := v_end;
  return next;
end;
$$;

/** May this store start one more minute of work? Free stops at zero, paid does not. */
create or replace function public.store_has_credit(p_store uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select st.remaining_credits >= 1 or st.allow_overage
     from public.store_credit_status(p_store) st),
    false
  );
$$;
