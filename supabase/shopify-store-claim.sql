-- ============================================================
-- Verafo x Shopify — claiming a store the Shopify app created
--
-- Problem this fixes: the Shopify app creates its Verafo store row with
-- `upsert_store_for_shop(domain)`, which sets `name` and `shopify_domain` and
-- leaves `owner_email` NULL. Store visibility is
-- `lower(coalesce(owner_email, '')) = <your email>`, so orders flowing into
-- that ownerless row are invisible to the merchant who owns the shop — and
-- when they try to add the store by hand, the unique index on
-- `stores.shopify_domain` rejects the insert instead of linking the two.
--
-- Result before this: an install-first merchant sees an empty dashboard and
-- cannot fix it from the UI.
--
-- Run in the Supabase SQL editor, after shopify-migration.sql.
-- ============================================================

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
begin
  v_email := verafo_current_email();
  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  end if;

  v_domain := lower(trim(coalesce(p_domain, '')));
  if v_domain = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_domain');
  end if;

  select id, owner_email, name
    into v_id, v_owner, v_name
  from stores
  where lower(shopify_domain) = v_domain;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Already mine: idempotent success, so a retry or a double-click is harmless.
  if lower(coalesce(v_owner, '')) = v_email then
    return jsonb_build_object('ok', true, 'store_id', v_id, 'store_name', v_name, 'already_owned', true);
  end if;

  -- Owned by someone else. Refuse: this is a link, not a transfer, and letting
  -- a caller take over a live store would be a data-protection hole.
  if v_owner is not null and v_owner <> '' then
    return jsonb_build_object('ok', false, 'reason', 'already_owned_by_another');
  end if;

  -- Only ever claims an OWNERLESS row, which is exactly what the Shopify app
  -- creates. The predicate is re-checked in the UPDATE so two concurrent
  -- claims cannot both win.
  update stores
     set owner_email = v_email
   where id = v_id
     and (owner_email is null or owner_email = '');

  return jsonb_build_object('ok', true, 'store_id', v_id, 'store_name', v_name);
end;
$$;

-- The caller is authenticated through the app, never anon. anon holds the
-- publishable key that ships in the browser, so it must not be able to claim.
revoke all on function verafo_claim_store(text) from public, anon;
grant execute on function verafo_claim_store(text) to authenticated;

-- Supporting lookup: claiming matches on the domain, so it wants an index that
-- does not care about case.
create index if not exists stores_shopify_domain_lower_idx
  on stores (lower(shopify_domain))
  where shopify_domain is not null;
