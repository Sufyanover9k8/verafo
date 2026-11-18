-- ============================================================================
-- Delete account (self-service, irreversible).
--
-- Removes everything that belongs to the signed-in merchant: their stores,
-- orders, outcomes, courier/call settings, Shopify sync state, lookups, chats,
-- notifications, and finally the auth user itself.
--
-- What it deliberately KEEPS: `buyers`.
-- Buyer rows are the system-wide intelligence layer (risk aggregates, feature
-- vector, embedding). Deleting a merchant's orders does not touch them, because
-- there is no DELETE trigger on `orders`: the aggregates and embeddings that
-- were built from that history stay exactly as they were. A merchant leaving
-- must not degrade everybody else's risk scores.
-- ============================================================================

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_stores uuid[] := '{}'::uuid[];
  v_domains text[] := '{}'::text[];
  v_result jsonb := '{}'::jsonb;
  n int;
begin
  if v_uid is null or v_email = '' then
    raise exception 'You must be signed in to delete your account.';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]),
         coalesce(array_agg(shopify_domain) filter (where shopify_domain is not null), '{}'::text[])
    into v_stores, v_domains
  from public.stores
  where lower(coalesce(owner_email, '')) = v_email;

  -- Outcomes hang off orders with NO ACTION, so they go first.
  delete from public.outcomes o
    using public.orders ord
   where o.order_id = ord.id
     and ord.store_id = any (v_stores);
  get diagnostics n = row_count;
  v_result := jsonb_set(v_result, '{outcomes}', to_jsonb(n));

  delete from public.shopify_sync_runs where store_id = any (v_stores);
  get diagnostics n = row_count;
  v_result := jsonb_set(v_result, '{shopify_sync_runs}', to_jsonb(n));

  -- The rest of the order-scoped tables cascade from orders.
  delete from public.orders where store_id = any (v_stores);
  get diagnostics n = row_count;
  v_result := jsonb_set(v_result, '{orders}', to_jsonb(n));

  delete from public.lookups where lower(coalesce(owner_email, '')) = v_email;
  get diagnostics n = row_count;
  v_result := jsonb_set(v_result, '{lookups}', to_jsonb(n));

  delete from public.chats where lower(coalesce(owner_email, '')) = v_email;
  get diagnostics n = row_count;
  v_result := jsonb_set(v_result, '{chats}', to_jsonb(n));

  delete from public.notifications where lower(coalesce(owner_email, '')) = v_email;
  get diagnostics n = row_count;
  v_result := jsonb_set(v_result, '{notifications}', to_jsonb(n));

  -- Shopify app state is keyed by shop domain rather than store id.
  if array_length(v_domains, 1) > 0 then
    delete from public.shop_rules where shop_domain = any (v_domains);
    delete from public.cod_events where shop_domain = any (v_domains);
  end if;

  -- Stores last: every store-scoped setting cascades from here.
  delete from public.stores where id = any (v_stores);
  get diagnostics n = row_count;
  v_result := jsonb_set(v_result, '{stores}', to_jsonb(n));

  delete from public.verafo_admins where lower(email) = v_email;

  -- The account itself. Cascades to identities and sessions.
  delete from auth.users where id = v_uid;

  return v_result;
end;
$$;

revoke all on function public.delete_my_account() from public;
revoke all on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Deletes the caller''s stores, orders and personal data, plus the auth user. Keeps public.buyers so system-wide risk intelligence survives.';
