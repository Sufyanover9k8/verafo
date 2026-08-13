-- ============================================================
-- Verafo — Feature Dimension implementation (spec: MVP)
-- Adds raw feature vector column + enriched rule-based risk score.
-- Run in the Supabase SQL editor (or via the management API).
-- ============================================================

-- Raw MVP feature vector (list of normalized numbers), stored per buyer
alter table buyers
  add column if not exists feature_vector real[];

-- ============================================================
-- Enhanced rule-based risk score (v2) implementing spec signals:
--   GROUP A order timing (night orders)
--   GROUP E outcome (refusal rate, confidence weighting)
--   GROUP F address (seen before / success history)
--   GROUP G identity (phone age in network, distinct stores)
--   cold-start rule (total_orders < 3 -> pull toward neutral)
-- ============================================================
create or replace function recompute_buyer(p_phone text)
returns buyers
language plpgsql
as $$
declare
  b buyers%rowtype;
  v_orders int;
  v_accepted int;
  v_refused int;
  v_rate numeric;
  v_score numeric;
  v_boost numeric := 0;
  v_night numeric := 0;          -- share of orders placed 18:00-02:59
  v_phone_days int := 0;         -- age of phone in network (days)
  v_stores int := 0;             -- distinct stores ordered from
  v_known_address boolean := false;
begin
  select
    count(*),
    count(*) filter (where ou.status = 'accepted'),
    count(*) filter (where ou.status = 'refused')
  into v_orders, v_accepted, v_refused
  from orders o
  join outcomes ou on ou.order_id = o.id
  where o.buyer_phone = p_phone
    and ou.status <> 'pending';

  if v_orders = 0 then
    v_score := 0.5;                        -- unknown, neutral — new buyer
  else
    v_rate := v_refused::numeric / v_orders;
    if v_orders < 3 then
      -- COLD-START: not enough data, pull toward neutral (spec rule)
      v_score := 0.5 + (v_rate - 0.5) * (v_orders / 3.0);
    else
      v_score := v_rate;                   -- trust the refusal rate
    end if;
  end if;

  -- Night-order ratio (18:00-02:59) → +0.1 per 25% late share, cap +0.2
  select coalesce(
    (count(*) filter (
       where extract(hour from o.ordered_at) >= 18
          or extract(hour from o.ordered_at) < 3
     ))::numeric / nullif(count(*), 0), 0)
  into v_night
  from orders o
  join outcomes ou on ou.order_id = o.id
  where o.buyer_phone = p_phone
    and ou.status <> 'pending';
  v_boost := v_boost + least(0.2, v_night * 0.4);

  -- Phone age in network: brand-new phones slightly riskier
  select coalesce(floor(extract(epoch from (now() - first_seen)) / 86400)::int, 0)
  into v_phone_days
  from buyers where phone = p_phone;
  if v_phone_days < 3 then
    v_boost := v_boost + 0.05;             -- very new number → +0.05
  elsif v_phone_days >= 30 then
    v_boost := v_boost - 0.05;             -- known 30+ days → -0.05
  end if;

  -- Distinct stores ordered from → real shopper, -0.1 if 2+
  select count(distinct o.store_id) into v_stores
  from orders o where o.buyer_phone = p_phone;
  if v_stores >= 2 then
    v_boost := v_boost - 0.1;
  end if;

  -- Address seen before (this buyer has a successful delivery at their address)
  select exists (
    select 1
    from orders o
    join outcomes ou on ou.order_id = o.id and ou.status = 'accepted'
    where o.buyer_phone = p_phone
      and o.address is not null
      and o.address = (
        select o2.address from orders o2
        where o2.buyer_phone = p_phone
        order by o2.ordered_at desc limit 1
      )
  )
  into v_known_address;
  if v_known_address then
    v_boost := v_boost - 0.05;             -- known-good address → -0.05
  end if;

  -- Buyer has accepted 5+ orders across 2+ stores → strong trust, -0.2
  if v_accepted >= 5 and v_stores >= 2 then
    v_boost := v_boost - 0.2;
  end if;

  v_score := v_score + v_boost;
  v_score := greatest(0.0, least(1.0, v_score));

  update buyers
  set total_orders = v_orders,
      total_accepted = v_accepted,
      total_refused = v_refused,
      risk_score = v_score,
      updated_at = now()
  where phone = p_phone
  returning * into b;

  return b;
end;
$$;

-- Keep buyer totals + score fresh automatically
create or replace function on_order_change()
returns trigger
language plpgsql
as $$
begin
  perform recompute_buyer(new.buyer_phone);
  return new;
end;
$$;

create or replace function on_outcome_change()
returns trigger
language plpgsql
as $$
declare
  v_phone text;
begin
  select buyer_phone into v_phone from orders where id = coalesce(new.order_id, old.order_id);
  if v_phone is not null then
    perform recompute_buyer(v_phone);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_order_recompute on orders;
create trigger trg_order_recompute
after insert on orders
for each row execute function on_order_change();

drop trigger if exists trg_outcome_recompute on outcomes;
create trigger trg_outcome_recompute
after insert or update of status on outcomes
for each row execute function on_outcome_change();

grant execute on function recompute_buyer(text) to anon;
