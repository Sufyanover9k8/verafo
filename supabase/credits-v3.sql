-- Credits v3: calls are counted as calls, not minutes.
--
--   A buyer check    = 1 credit
--   A call           = 2 credits, whatever its length
--
--   Free         100 check credits a month, and 10 calls in total (no reset).
--                Nothing overages: both stop at zero.
--   Standard     100 check credits a month, then PKR 21 a credit.
--                100 calls a month, then PKR 40 a call (PKR 20 a call credit).
--   Founder One  350 check credits a month, then PKR 16 a credit.
--                300 calls a month, then PKR 30 a call (PKR 15 a call credit).
--
-- Two credits a call is what makes the per-call prices divide into whole
-- credits: PKR 40 / 2 = PKR 20, PKR 30 / 2 = PKR 15.

alter table public.plans
  add column if not exists call_credits integer not null default 2,
  add column if not exists included_calls integer not null default 0,
  add column if not exists overage_pkr_per_call numeric(10, 2) not null default 0,
  add column if not exists calls_one_time boolean not null default false;

update public.plans set
  included_credits = 100,
  overage_pkr_per_credit = 0,
  overage_cap_credits = 0,
  allow_overage = false,
  usage_ceiling_pkr = 0,
  call_credits = 2,
  included_calls = 10,
  overage_pkr_per_call = 0,
  calls_one_time = true
where code = 'free';

update public.plans set
  price_pkr = 6999,
  included_credits = 100,
  overage_pkr_per_credit = 21,
  overage_cap_credits = 0,
  allow_overage = true,
  usage_ceiling_pkr = 100000,
  trial_days = 7,
  call_credits = 2,
  included_calls = 100,
  overage_pkr_per_call = 40,
  calls_one_time = false
where code = 'standard';

update public.plans set
  price_pkr = 12499,
  included_credits = 350,
  overage_pkr_per_credit = 16,
  overage_cap_credits = 0,
  allow_overage = true,
  usage_ceiling_pkr = 100000,
  trial_days = 45,
  call_credits = 2,
  included_calls = 300,
  overage_pkr_per_call = 30,
  calls_one_time = false
where code = 'founder';

alter table public.store_plans
  add column if not exists call_overage_billed_credits integer not null default 0;

-- One call costs a fixed number of credits now, so replace the minute-based
-- writer. A call of any length writes the plan's call_credits.
create or replace function public.verafo_credit_from_call()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_credits integer;
begin
  select coalesce(nullif(plan_name, ''), 'free')
    into v_code
    from public.store_plans
   where store_id = new.store_id;

  select coalesce(call_credits, 2)
    into v_credits
    from public.plans
   where code = coalesce(v_code, 'free');

  insert into public.credit_events (store_id, kind, credits, ref, occurred_at)
  values (
    new.store_id,
    'call',
    coalesce(v_credits, 2),
    new.verification_id::text,
    coalesce(new.created_at, now())
  );
  return new;
end;
$$;

-- The return shape grows, so replace the functions outright.
drop function if exists public.store_has_credit(uuid);
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
  calls_one_time boolean
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
  included_credits := coalesce(nullif(v_row.included_credits, 0), v_plan.included_credits);
  used_credits := v_used;
  remaining_credits := greatest(0, included_credits - v_used);
  overage_credits := greatest(0, v_used - included_credits);
  overage_pkr_per_credit := coalesce(v_row.overage_pkr_per_credit, v_plan.overage_pkr_per_credit);
  allow_overage := v_plan.allow_overage;
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

-- May this store place one more call? Free's ten calls are one-time, so this
-- is the gate that actually stops it.
create or replace function public.store_has_call_credit(p_store uuid)
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
