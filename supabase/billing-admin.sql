-- Admin billing: read every store's plan and allowances, and change them.
--
-- Until now `store_plans` and `credit_events` were read-only for the web app:
-- plans were written by the Shopify app with the service-role key, and credits
-- were metered by triggers. The admin Billing tab needs to change a merchant's
-- plan, package size, credits and calls from the dashboard, so this adds the
-- write policies (admins only, same `verafo_is_admin()` the rest of the app
-- uses) plus the RPCs the page calls.
--
-- Every allowance change is a row in `credit_events`, never an update of a
-- counter: the ledger stays complete, `store_credit_status` keeps deriving the
-- numbers, and a mistake can be corrected with the opposite entry.

-- ---------------------------------------------------------------------------
-- 1. Policies
-- ---------------------------------------------------------------------------

alter table public.store_plans enable row level security;

drop policy if exists store_plans_admin_write on public.store_plans;
create policy store_plans_admin_write on public.store_plans
  for all to authenticated
  using (public.verafo_is_admin())
  with check (public.verafo_is_admin());

alter table public.credit_events enable row level security;

drop policy if exists credit_events_admin_write on public.credit_events;
create policy credit_events_admin_write on public.credit_events
  for all to authenticated
  using (public.verafo_is_admin())
  with check (public.verafo_is_admin());

-- The plans table is pricing copy, not merchant data: the billing page needs it
-- to show what each plan includes, and every signed-in user may read it.
alter table public.plans enable row level security;

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 2. One row per store, for the admin table
-- ---------------------------------------------------------------------------

create or replace function public.admin_billing_overview()
returns table (
  store_id uuid,
  store_name text,
  shopify_domain text,
  owner_email text,
  plan_code text,
  plan_name text,
  plan_status text,
  suspended boolean,
  price_pkr numeric,
  included_credits integer,
  included_override integer,
  used_credits numeric,
  remaining_credits numeric,
  overage_credits numeric,
  overage_pkr_per_credit numeric,
  unlimited_checks boolean,
  included_calls integer,
  used_calls integer,
  remaining_calls integer,
  overage_calls integer,
  overage_pkr_per_call numeric,
  owed_pkr numeric,
  cycle_end date,
  billed_credits integer,
  billed_calls integer,
  subscription_id text,
  current_period_end timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.verafo_is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select s.id,
         s.name,
         s.shopify_domain,
         s.owner_email,
         st.plan_code,
         st.plan_name,
         st.status,
         coalesce(sp.suspended, false),
         st.price_pkr,
         st.included_credits,
         coalesce(sp.included_credits, 0),
         st.used_credits,
         st.remaining_credits,
         st.overage_credits,
         st.overage_pkr_per_credit,
         st.unlimited_checks,
         st.included_calls,
         st.used_calls,
         st.remaining_calls,
         st.overage_calls,
         st.overage_pkr_per_call,
         round(
           st.overage_credits * st.overage_pkr_per_credit
           + st.overage_calls * st.overage_pkr_per_call,
           2
         )::numeric,
         st.cycle_end,
         coalesce(sp.overage_billed_credits, 0),
         coalesce(sp.call_overage_billed_credits, 0),
         sp.subscription_id,
         sp.current_period_end
  from public.stores s
  left join public.store_plans sp on sp.store_id = s.id
  cross join lateral public.store_credit_status(s.id) st
  order by s.name;
end;
$function$;

revoke all on function public.admin_billing_overview() from public;
grant execute on function public.admin_billing_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Mutations
-- ---------------------------------------------------------------------------

-- Move a store onto another plan. The status is left alone, so suspending a
-- store and then changing its plan does not silently un-suspend it.
create or replace function public.admin_set_plan(p_store uuid, p_plan text)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text;
begin
  if not public.verafo_is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select name into v_name from public.plans where code = p_plan;
  if v_name is null then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;

  insert into public.store_plans (store_id, plan_name, status)
  values (p_store, p_plan, 'active')
  on conflict (store_id) do update
    set plan_name = excluded.plan_name,
        updated_at = now();

  return v_name;
end;
$function$;

-- Status + suspension, the two switches that stop a store spending.
create or replace function public.admin_set_plan_state(
  p_store uuid,
  p_status text,
  p_suspended boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.verafo_is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  insert into public.store_plans (store_id, plan_name, status, suspended)
  values (p_store, 'free', p_status, p_suspended)
  on conflict (store_id) do update
    set status = excluded.status,
        suspended = excluded.suspended,
        updated_at = now();
end;
$function$;

-- A package override: how many check credits this store gets instead of its
-- plan's number. Zero means "use the plan", which is what the status function
-- already reads.
create or replace function public.admin_set_package(p_store uuid, p_included integer)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.verafo_is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_included < 0 then
    raise exception 'the package cannot be negative' using errcode = '22023';
  end if;

  insert into public.store_plans (store_id, plan_name, included_credits)
  values (p_store, 'free', p_included)
  on conflict (store_id) do update
    set included_credits = excluded.included_credits,
        updated_at = now();
end;
$function$;

-- Add allowance without touching the package: `p_checks` extra check credits
-- and `p_calls` extra calls for this cycle. Negative numbers take allowance
-- away. Written as ledger entries, so the usage history stays readable:
--   checks -> kind 'adjust' (the check pool sums everything that is not a call)
--   calls  -> kind 'call', two credits per call, negated to add allowance
create or replace function public.admin_grant_allowance(
  p_store uuid,
  p_checks integer default 0,
  p_calls integer default 0,
  p_note text default null
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_ids uuid[] := '{}';
  v_id uuid;
  v_ref text := coalesce(nullif(btrim(p_note), ''), 'admin grant');
  v_per_call integer := 2;
  v_plan text;
begin
  if not public.verafo_is_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select coalesce(sp.plan_name, 'free') into v_plan from public.store_plans sp where sp.store_id = p_store;
  select coalesce(pl.call_credits, 2) into v_per_call from public.plans pl where pl.code = coalesce(v_plan, 'free');
  v_per_call := coalesce(v_per_call, 2);

  if coalesce(p_checks, 0) <> 0 then
    insert into public.credit_events (store_id, kind, credits, ref)
    values (p_store, 'adjust', -p_checks, v_ref)
    returning id into v_id;
    v_ids := array_append(v_ids, v_id);
  end if;

  if coalesce(p_calls, 0) <> 0 then
    insert into public.credit_events (store_id, kind, credits, ref)
    values (p_store, 'call', -(p_calls::numeric * v_per_call), v_ref)
    returning id into v_id;
    v_ids := array_append(v_ids, v_id);
  end if;

  return v_ids;
end;
$function$;

revoke all on function public.admin_set_plan(uuid, text) from public;
revoke all on function public.admin_set_plan_state(uuid, text, boolean) from public;
revoke all on function public.admin_set_package(uuid, integer) from public;
revoke all on function public.admin_grant_allowance(uuid, integer, integer, text) from public;

grant execute on function public.admin_set_plan(uuid, text) to authenticated;
grant execute on function public.admin_set_plan_state(uuid, text, boolean) to authenticated;
grant execute on function public.admin_set_package(uuid, integer) to authenticated;
grant execute on function public.admin_grant_allowance(uuid, integer, integer, text) to authenticated;

comment on function public.admin_billing_overview() is
  'Admin billing table: one row per store with its plan, check credits, calls and what it owes this cycle.';
comment on function public.admin_grant_allowance(uuid, integer, integer, text) is
  'Admin credit change. Positive numbers add allowance, negative take it away; every change is a credit_events row.';
