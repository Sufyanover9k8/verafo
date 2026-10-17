-- ============================================================
-- Risk score: an unscored buyer must stay exactly neutral (0.5)
--
-- THE DEFECT. recompute_buyer() computes 0.5 when the buyer has no resolved
-- order ("unknown, neutral — new buyer"), then adds the signal boosts anyway:
--
--   first_seen today            +0.05
--   address never seen before   +0.05
--
-- A brand-new buyer — the exact case a Shopify order creates — therefore lands
-- at 0.60 with ZERO resolved orders. That is the MEDIUM band (>0.45), so the
-- stored score claims a risk level for someone Verafo knows nothing about. The
-- UI reads the band from the resolved-order count and shows NEUTRAL, so the
-- screen looks right while the database disagrees — and the Dashboard's
-- "Average risk" KPI averages the stored scores, so it drifts upward on a fresh
-- book for no reason.
--
-- The boosts describe evidence about resolved orders: an unusual address and a
-- new number are meaningful when there is a history to compare against. With no
-- history there is nothing to raise or lower, so they are not applied.
--
-- Behaviour with one or more resolved orders is unchanged, including the
-- pull-toward-0.50 damping below three resolved orders.
--
-- Run in the Supabase SQL editor. Idempotent: replaces the function in place,
-- so the existing triggers pick it up with no data migration. Scores correct
-- themselves the next time any order or outcome for that buyer changes; to
-- refresh the whole book immediately, call:
--   select recompute_buyer(phone) from buyers;
-- ============================================================

create or replace function recompute_buyer(p_phone text)
returns buyers
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b buyers%rowtype;
  v_orders int;
  v_accepted int;
  v_refused int;
  v_rate numeric;
  v_score numeric;
  v_boost numeric := 0;
  v_new_address boolean := false;
  v_first_today boolean := false;
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
    v_score := 0.5;                       -- unknown, neutral — new buyer
  else
    v_rate := v_refused::numeric / v_orders;
    if v_orders < 3 then
      v_score := 0.5 + (v_rate - 0.5) * (v_orders / 3.0);   -- pull toward 0.5: not enough data
    else
      v_score := v_rate;                  -- trust the refusal rate
    end if;
  end if;

  /*
   * Signals only apply once something has resolved. See the note at the top of
   * this file: with no resolved order every boost used to be added to a score
   * that means "no idea", pushing a fresh buyer to 0.60.
   */
  if v_orders > 0 then
    -- Address never seen before → +0.05
    select exists (
      select 1
      from orders o
      where o.buyer_phone = p_phone
        and o.address is not null
        and o.address = (
          select o2.address from orders o2
          where o2.buyer_phone = p_phone order by o2.ordered_at desc limit 1
        )
      group by o.address
      having count(*) = 1
    )
    into v_new_address;
    if v_new_address then
      v_boost := v_boost + 0.05;
    end if;

    -- Phone number seen for the first time today → +0.05
    select exists (
      select 1 from buyers where phone = p_phone and first_seen::date = current_date
    )
    into v_first_today;
    if v_first_today then
      v_boost := v_boost + 0.05;
    end if;

    -- Buyer has accepted 5+ orders across 2+ stores → strong trust, -0.2
    if v_accepted >= 5 and (
      select count(distinct store_id) from orders where buyer_phone = p_phone
    ) >= 2 then
      v_boost := v_boost - 0.2;
    end if;
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
