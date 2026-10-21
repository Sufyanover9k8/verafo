-- ============================================================
-- One merchant, one store — enforced, not fixed case by case
--
-- THE PATTERN, which every new merchant would have hit:
--
--   1. The Shopify app creates a `stores` row keyed by the myshopify handle
--      (`orjbqb-uk.myshopify.com`), with no owner, and renames it on every
--      webhook.
--   2. A merchant who already had a store — created in onboarding, or with a
--      custom domain — gets a second row. Their dashboard opens on whichever
--      row sorts first, and if that row is the empty one it looks like all
--      their data vanished.
--   3. An ownerless row is invisible to every query, so nobody notices until
--      an order fails to appear.
--
-- The fix is a rule, not a script: after ANY path that attaches a store to a
-- merchant, all of that merchant's stores are merged into one.
--
-- Which one survives is not arbitrary. `upsert_store_for_shop` writes to the
-- row keyed by the myshopify handle, so THAT row must be the survivor — if a
-- different row won, the next webhook would fail to find its store, insert a
-- fresh one, and recreate the duplicate. Everything else follows from that.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

create or replace function verafo_merge_merchant_stores(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_keep   uuid;
  v_name   text;
  v_row    record;
  v_merged int := 0;
  v_moved  int := 0;
  v_step   int := 0;
begin
  if v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_email');
  end if;

  -- The survivor: the myshopify-handle row first (the app writes there), then
  -- the one with the most orders, then the oldest.
  select s.id into v_keep
  from stores s
  where lower(coalesce(s.owner_email, '')) = v_email
  order by (lower(coalesce(s.shopify_domain, '')) like '%.myshopify.com') desc,
           (select count(*) from orders o where o.store_id = s.id) desc,
           s.created_at asc
  limit 1;

  if v_keep is null then
    return jsonb_build_object('ok', true, 'merged', 0, 'orders_moved', 0);
  end if;

  -- The friendliest name on offer: a real one, never a bare domain. The
  -- survivor's own name wins if it already qualifies.
  select s.name into v_name
  from stores s
  where lower(coalesce(s.owner_email, '')) = v_email
    and coalesce(trim(s.name), '') <> ''
    and lower(s.name) not like '%.myshopify.com'
    and lower(s.name) not like '%.store'
    and lower(s.name) <> lower(coalesce(s.shopify_domain, ''))
  order by (s.id = v_keep) desc
  limit 1;

  -- Everything else this merchant owns stops being theirs, and its orders move
  -- to the survivor. The row itself is kept: an id may be referenced by the
  -- Shopify app's own mapping, and deleting it would turn every future webhook
  -- into a foreign-key failure.
  for v_row in
    select s.id
    from stores s
    where lower(coalesce(s.owner_email, '')) = v_email
      and s.id <> v_keep
  loop
    update orders set store_id = v_keep where store_id = v_row.id;
    get diagnostics v_step = row_count;
    v_moved := v_moved + v_step;

    update stores
       set owner_email = null
     where id = v_row.id;

    v_merged := v_merged + 1;
  end loop;

  update stores
     set owner_email = v_email,
         name = coalesce(v_name, name)
   where id = v_keep;

  return jsonb_build_object(
    'ok', true,
    'store_id', v_keep,
    'merged', v_merged,
    'orders_moved', v_moved
  );
end;
$$;

revoke all on function verafo_merge_merchant_stores(text) from public, anon;
grant execute on function verafo_merge_merchant_stores(text) to service_role;

-- ── Every path that attaches a store now merges ─────────────
-- 1. A merchant claims the store the app created for their shop.
create or replace function verafo_claim_store(p_domain text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_domain text;
  v_id     uuid;
  v_owner  text;
  v_name   text;
  v_orders int;
  v_kept   uuid;
begin
  v_email := verafo_current_email();
  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_domain := lower(trim(coalesce(p_domain, '')));
  if v_domain = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_domain');
  end if;

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

  if lower(coalesce(v_owner, '')) = lower(v_email) then
    -- Already theirs: still merge, so a previously split account heals itself.
    perform verafo_merge_merchant_stores(v_email);
    select s.id into v_kept
    from stores s
    where lower(coalesce(s.owner_email, '')) = lower(v_email)
    order by (lower(coalesce(s.shopify_domain, '')) like '%.myshopify.com') desc
    limit 1;
    return jsonb_build_object('ok', true, 'store_id', coalesce(v_kept, v_id),
                              'store_name', v_name, 'already_owned', true);
  end if;

  if coalesce(trim(v_owner), '') <> '' then
    return jsonb_build_object('ok', false, 'reason', 'already_owned_by_another');
  end if;

  if coalesce(v_orders, 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_orders');
  end if;

  update stores
     set owner_email = lower(v_email)
   where id = v_id
     and (owner_email is null or owner_email = '');

  -- The merchant may already have a store. Merge rather than end up with two.
  perform verafo_merge_merchant_stores(v_email);

  select s.id, s.name into v_kept, v_name
  from stores s
  where lower(coalesce(s.owner_email, '')) = lower(v_email)
  order by (lower(coalesce(s.shopify_domain, '')) like '%.myshopify.com') desc
  limit 1;

  return jsonb_build_object('ok', true, 'store_id', coalesce(v_kept, v_id), 'store_name', v_name);
end;
$$;

revoke all on function verafo_claim_store(text) from public, anon;
grant execute on function verafo_claim_store(text) to authenticated;

-- 2. The Shopify app stamps the owner at install (service role).
create or replace function verafo_set_store_owner(p_domain text, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text := lower(trim(coalesce(p_domain, '')));
  v_email  text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
  v_owner text;
  v_kept uuid;
begin
  if v_domain = '' or v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'missing_argument');
  end if;

  select id, owner_email into v_id, v_owner
  from stores
  where lower(shopify_domain) = v_domain;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(trim(v_owner), '') <> '' then
    return jsonb_build_object('ok', true, 'already_owned', true, 'store_id', v_id);
  end if;

  update stores
     set owner_email = v_email
   where id = v_id
     and coalesce(trim(owner_email), '') = '';

  perform verafo_merge_merchant_stores(v_email);

  select s.id into v_kept
  from stores s
  where lower(coalesce(s.owner_email, '')) = v_email
  order by (lower(coalesce(s.shopify_domain, '')) like '%.myshopify.com') desc
  limit 1;

  return jsonb_build_object('ok', true, 'already_owned', false, 'store_id', coalesce(v_kept, v_id));
end;
$$;

revoke all on function verafo_set_store_owner(text, text) from public, anon;
grant execute on function verafo_set_store_owner(text, text) to service_role;

-- ── Heal the accounts that are already split ────────────────
-- One row per merchant email; each call is a no-op when they own a single
-- store, so this is safe to run again after any incident.
select email, verafo_merge_merchant_stores(email) as result
from (
  select distinct lower(owner_email) as email
  from stores
  where coalesce(trim(owner_email), '') <> ''
) t
order by email;

notify pgrst, 'reload schema';
