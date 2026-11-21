-- Credits v4: bigger check packages, and an unlimited Founder One.
--
--   A buyer check    = 1 credit
--   A call           = 2 credits, whatever its length
--
--   Free         100 check credits a month, and 10 calls in total (no reset).
--                Nothing overages: both stop at zero.
--   Standard     1,500 check credits a month, then PKR 2 a check.
--                100 calls a month, then PKR 40 a call (PKR 20 a call credit).
--   Founder One  Unlimited checks.
--                300 calls a month, then PKR 30 a call (PKR 15 a call credit).
--
-- Founder One's checks are unlimited rather than a big number: the status
-- function returns unlimited_checks, and every gate (store_has_credit, the
-- edge functions, the billing sweep) reads the flag before it looks at a
-- count. A store on Founder One can never be refused a check and is never
-- billed for one.

alter table public.plans
  add column if not exists unlimited_checks boolean not null default false;

update public.plans set
  included_credits = 100,
  overage_pkr_per_credit = 0,
  overage_cap_credits = 0,
  allow_overage = false,
  usage_ceiling_pkr = 0,
  unlimited_checks = false
where code = 'free';

update public.plans set
  price_pkr = 6999,
  included_credits = 1500,
  overage_pkr_per_credit = 2,
  overage_cap_credits = 0,
  allow_overage = true,
  usage_ceiling_pkr = 100000,
  trial_days = 7,
  unlimited_checks = false
where code = 'standard';

update public.plans set
  price_pkr = 12499,
  included_credits = 0,
  overage_pkr_per_credit = 0,
  overage_cap_credits = 0,
  allow_overage = true,
  usage_ceiling_pkr = 100000,
  trial_days = 45,
  unlimited_checks = true
where code = 'founder';

-- The return shape grows again, so replace the functions in dependency order.
drop function if exists public.store_has_credit(uuid);
drop function if exists public.store_has_call_credit(uuid);
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
  cycle_end date,
  call_credits integer,
  included_calls integer,
  used_calls integer,
  remaining_calls integer,
  overage_calls integer,
  overage_pkr_per_call numeric,
  overage_call_pkr numeric,
  calls_one_time boolean,
  unlimited_checks boolean
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
  v_call_credits numeric;
  v_per_call integer;
  v_unlimited boolean;
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
  where c.store_id = p_store and c.kind <> 'call'
    and c.occurred_at >= v_start and c.occurred_at < v_end;

  v_per_call := coalesce(v_plan.call_credits, 2);
  v_unlimited := coalesce(v_plan.unlimited_checks, false);

  -- A one-time call allowance never resets, so its usage is counted from the
  -- first call the store ever made.
  select coalesce(sum(c.credits), 0) into v_call_credits
  from public.credit_events c
  where c.store_id = p_store and c.kind = 'call'
    and (
      coalesce(v_plan.calls_one_time, false)
      or (c.occurred_at >= v_start and c.occurred_at < v_end)
    );

  plan_code := v_plan.code;
  plan_name := v_plan.name;
  status := coalesce(v_row.status, 'active');
  unlimited_checks := v_unlimited;

  -- Unlimited means the count is informational only: report what was used,
  -- claim no package, and never bill an overage.
  included_credits := case
    when v_unlimited then 0
    else coalesce(nullif(v_row.included_credits, 0), v_plan.included_credits)
  end;
  used_credits := v_used;
  remaining_credits := case when v_unlimited then 0 else greatest(0, included_credits - v_used) end;
  overage_credits := case when v_unlimited then 0 else greatest(0, v_used - included_credits) end;
  overage_pkr_per_credit := case
    when v_unlimited then 0
    else coalesce(v_row.overage_pkr_per_credit, v_plan.overage_pkr_per_credit)
  end;
  allow_overage := coalesce(v_plan.allow_overage, false);
  usage_ceiling_pkr := v_plan.usage_ceiling_pkr;
  price_pkr := v_plan.price_pkr;
  cycle_start := v_start;
  cycle_end := v_end;

  call_credits := v_per_call;
  included_calls := coalesce(v_plan.included_calls, 0);
  -- Calls are whole things: a partly used call credit still spends a call.
  used_calls := ceil(v_call_credits / greatest(v_per_call, 1))::integer;
  remaining_calls := greatest(0, included_calls - used_calls);
  overage_calls := greatest(0, used_calls - included_calls);
  overage_pkr_per_call := coalesce(v_plan.overage_pkr_per_call, 0);
  overage_call_pkr := overage_calls * coalesce(v_plan.overage_pkr_per_call, 0);
  calls_one_time := coalesce(v_plan.calls_one_time, false);
  return next;
end;
$$;

-- May this store run one more buyer check?
create function public.store_has_credit(p_store uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select st.unlimited_checks or st.remaining_credits >= 1 or st.allow_overage
     from public.store_credit_status(p_store) st),
    false
  );
$$;

-- May this store place one more call? Free's ten calls are one-time, so this
-- is the gate that actually stops it.
create function public.store_has_call_credit(p_store uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select st.remaining_calls >= 1
            or (st.allow_overage and st.overage_pkr_per_call > 0)
     from public.store_credit_status(p_store) st),
    false
  );
$$;
