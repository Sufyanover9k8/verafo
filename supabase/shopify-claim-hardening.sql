-- ============================================================
-- Claim a Shopify store: stop handing out rows that are not yours
--
-- WHAT HAPPENED. `verafo_claim_store` only checked that the row had no owner.
-- The dashboard banner claimed "the first claimable store", so every click took
-- whichever row came back first. A merchant's switcher ended up listing:
--
--   Orjbqb-uk.myshopify.com                        real shop, 11 orders
--   app-review-28a50a25-r108519-a0-primary…         Shopify app-review installs
--   app-review-28a50a25-r138930-a0…                 (not a merchant at all)
--   probe.myshopify.com                             a test row created by a probe
--   Sanicore                                        theirs
--
-- Three rules close it:
--   1. A store is only claimable once it has at least one order. An empty row
--      has nothing to show, so claiming it is pointless — and it is exactly the
--      kind of row that accumulates from installs and probes.
--   2. Shopify's own review-store domains are never claimable.
--   3. The same guards live inside `verafo_claim_store`, so calling the RPC
--      directly cannot bypass the list.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

-- ── 1. Clean up the rows that should never have been claimed ──
-- Un-own, do not delete: the rows and any orders stay, they simply stop being
-- attached to somebody who is not their merchant.
update stores
   set owner_email = null
 where shopify_domain like 'app-review-%'
    or shopify_domain like 'probe.%';

-- The probe row has no orders by construction, so it can go entirely.
delete from stores s
 where s.shopify_domain = 'probe.myshopify.com'
   and not exists (select 1 from orders o where o.store_id = s.id);

-- ── 2. What the merchant may claim ──────────────────────────
create or replace function verafo_claimable_stores()
returns table (
  id uuid,
  name text,
  shopify_domain text,
  orders int,
  last_order_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.name,
    s.shopify_domain,
    (select count(*)::int
       from orders o
      where o.store_id = s.id
        and o.deleted_at is null) as live_orders,
    (select max(o.ordered_at) from orders o where o.store_id = s.id)
  from stores s
  where coalesce(trim(s.owner_email), '') = ''
    and s.shopify_domain is not null
    and s.shopify_domain not like 'app-review-%'
    and s.shopify_domain not like 'probe.%'
    -- Only a store that has actually received an order is worth offering.
    and exists (
      select 1 from orders o
       where o.store_id = s.id
         and o.deleted_at is null
    )
    and verafo_current_email() is not null
  order by 5 desc nulls last, s.created_at desc
  limit 20;
$$;

revoke all on function verafo_claimable_stores() from public, anon;
grant execute on function verafo_claimable_stores() to authenticated;

-- ── 3. The same guards inside the claim itself ──────────────
create or replace function verafo_claim_store(p_domain text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_domain text;
  v_id uuid;
  v_owner text;
  v_name text;
  v_orders int;
begin
  v_email := verafo_current_email();
  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_domain := lower(trim(coalesce(p_domain, '')));
  if v_domain = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_domain');
  end if;

  -- Shopify's automated review installs are not merchants' shops.
  if v_domain like 'app-review-%' or v_domain like 'probe.%' then
    return jsonb_build_object('ok', false, 'reason', 'not_claimable');
  end if;

  select s.id, s.owner_email, s.name,
         (select count(*)::int from orders o where o.store_id = s.id and o.deleted_at is null)
    into v_id, v_owner, v_name, v_orders
  from stores s
  where lower(s.shopify_domain) = v_domain;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Already mine: idempotent success, so a retry or a double-click is harmless.
  if lower(coalesce(v_owner, '')) = v_email then
    return jsonb_build_object('ok', true, 'store_id', v_id, 'store_name', v_name, 'already_owned', true);
  end if;

  -- Owned by someone else: a link, never a transfer.
  if coalesce(trim(v_owner), '') <> '' then
    return jsonb_build_object('ok', false, 'reason', 'already_owned_by_another');
  end if;

  -- An empty row has nothing to show and is usually an install artefact.
  if coalesce(v_orders, 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_orders');
  end if;

  update stores
     set owner_email = v_email
   where id = v_id
     and (owner_email is null or owner_email = '');

  return jsonb_build_object('ok', true, 'store_id', v_id, 'store_name', v_name);
end;
$$;

revoke all on function verafo_claim_store(text) from public, anon;
grant execute on function verafo_claim_store(text) to authenticated;

-- ── 4. Stop the app renaming a merchant's store ─────────────
-- `upsert_store_for_shop` ran `do update set name = excluded.name`, where the
-- name IS the myshopify handle. Every webhook therefore renamed the store to
-- something like `orjbqb-uk.myshopify.com`: a merchant who called their store
-- "Sanicore" watched it become a random handle, and any manual rename was
-- undone by the next order.
--
-- Now the existing name wins. It is only filled in when empty, or when it is
-- still just the domain — i.e. the app named it and nobody chose better.
create or replace function upsert_store_for_shop(p_domain text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into stores (name, shopify_domain)
  values (p_domain, p_domain)
  on conflict (shopify_domain) where shopify_domain is not null
  do update set name = case
      when coalesce(trim(stores.name), '') = ''
        or lower(stores.name) = lower(coalesce(stores.shopify_domain, ''))
        then excluded.name
      else stores.name
    end
  returning id into v_id;

  return v_id;
end;
$$;

-- The Shopify app calls this with the service role. `anon` holds the key that
-- ships in the browser, so it must not be able to mint store rows.
revoke all on function upsert_store_for_shop(text) from public, anon;
grant execute on function upsert_store_for_shop(text) to service_role;

-- ── 5. Report: who owns what now ────────────────────────────
select s.name,
       s.shopify_domain,
       s.owner_email,
       (select count(*) from orders o where o.store_id = s.id) as orders
from stores s
order by s.owner_email nulls first, orders desc;

notify pgrst, 'reload schema';
