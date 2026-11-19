-- City refusal prior for the buyer embedding.
--
-- Why this exists: the old feature vector carried a 10-slot one-hot over a fixed
-- list of cities. That is a coarse proxy -- it carves buyers into ten blobs and
-- says nothing about how that city actually behaves. What the model (and the
-- cluster map) can use instead is one number per city: how often deliveries
-- there come back. That is a learned prior, not a label about the buyer, so it
-- does not leak the verdict the rule engine already produced.
--
-- Refreshed monthly by pg_cron. The edge function reads it through
-- `verafo_city_rate()` and falls back to 0.5 when the prior is missing, so the
-- function keeps working before this file has ever been run.

create table if not exists public.city_base_rates (
  city       text primary key,
  samples    integer      not null default 0,
  refusals   integer      not null default 0,
  rate       numeric(6, 5) not null default 0.5,
  updated_at timestamptz  not null default now()
);

comment on table public.city_base_rates is
  'Aggregate refusal prior per city, learned from resolved orders. No personal data.';

-- Service role only: this is an internal prior, not something a merchant reads.
alter table public.city_base_rates enable row level security;
revoke all on public.city_base_rates from anon, authenticated;

create or replace function public.verafo_refresh_city_rates(p_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  with decided as (
    select
      lower(trim(o.city)) as city,
      count(*) as samples,
      count(*) filter (
        where f.status in ('rejected', 'returned')
      ) as refusals
    from public.orders o
    join public.order_fulfillment f on f.order_id = o.id
    where o.city is not null
      and trim(o.city) <> ''
      and f.status in ('approved', 'rejected', 'delivered', 'returned')
      and o.ordered_at >= now() - (p_days || ' days')::interval
    group by 1
  )
  insert into public.city_base_rates (city, samples, refusals, rate, updated_at)
  select
    city,
    samples,
    refusals,
    round(refusals::numeric / greatest(samples, 1), 5),
    now()
  from decided
  on conflict (city) do update
    set samples    = excluded.samples,
        refusals   = excluded.refusals,
        rate       = excluded.rate,
        updated_at = excluded.updated_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.verafo_refresh_city_rates(integer) is
  'Rebuilds public.city_base_rates from resolved orders. Run monthly.';

-- One number in, one number out. Returns the neutral 0.5 when the city has no
-- history yet, which is what the edge function would use anyway.
create or replace function public.verafo_city_rate(p_city text)
returns double precision
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select r.rate::double precision
      from public.city_base_rates r
      where r.city = lower(trim(p_city))
        and r.samples >= 20
    ),
    0.5
  );
$$;

comment on function public.verafo_city_rate(text) is
  'Refusal prior for a city (0.5 when there is not enough history).';

revoke all on function public.verafo_refresh_city_rates(integer) from anon, authenticated;
grant execute on function public.verafo_city_rate(text) to anon, authenticated, service_role;

-- Monthly refresh, if pg_cron is available on this project.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('verafo-city-rates')
      where exists (select 1 from cron.job where jobname = 'verafo-city-rates');
    perform cron.schedule(
      'verafo-city-rates',
      '0 4 1 * *',
      $cron$select public.verafo_refresh_city_rates(180)$cron$
    );
  end if;
end;
$$;

-- Build it now so the first embed after this file is applied already has a prior.
select public.verafo_refresh_city_rates(180) as cities_refreshed;
