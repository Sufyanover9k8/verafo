-- ============================================================
-- Shopify stores that nobody owns — and how a merchant connects one
--
-- THE GAP, seen in production. The Shopify app creates its store row from the
-- shop domain alone:
--
--   insert into stores (name, shopify_domain) values (p_domain, p_domain)
--
-- `owner_email` stays NULL. Every dashboard query is scoped to
-- `owner_email = <you>`, so those orders are written, counted, and completely
-- invisible to the merchant who owns the shop. The database gains a row, the
-- screen gains nothing. To the merchant it looks like syncing is broken.
--
-- There IS a claim function, `verafo_claim_store(domain)`, but the only screen
-- that called it was onboarding — which never runs for a merchant who already
-- owns a store. So the store stays ownerless forever.
--
-- This file adds the two pieces that make it recoverable:
--   1. `verafo_claimable_stores()` — the list a merchant may claim. The client
--      cannot compute this itself, because an ownerless row is invisible to it.
--   2. `verafo_set_store_owner()` — service-role only, so the Shopify app can
--      stamp the owner at install time when it knows the shop's email.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

-- ── 1. What can I claim? ────────────────────────────────────
-- SECURITY DEFINER: the caller cannot read an ownerless store through RLS, so
-- the list has to be produced by a function that can. It returns ONLY unowned
-- Shopify stores — never another merchant's, never a store with an owner.
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
        and o.deleted_at is null),
    (select max(o.ordered_at) from orders o where o.store_id = s.id)
  from stores s
  where coalesce(trim(s.owner_email), '') = ''
    and s.shopify_domain is not null
    and verafo_current_email() is not null
  order by 5 desc nulls last, s.created_at desc
  limit 20;
$$;

revoke all on function verafo_claimable_stores() from public, anon;
grant execute on function verafo_claimable_stores() to authenticated;

-- ── 2. Let the Shopify app stamp the owner at install ──────
-- The webhook has no idea which Verafo account owns a shop, but the OAuth
-- install does: it can read `shop { email }` and pass it here. Service role
-- only — a browser must never be able to hand a store to an arbitrary email.
--
-- Deliberately refuses to overwrite an existing owner: an install must never
-- be a way to steal a store from another account.
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
    -- Already owned (by the merchant themselves, or someone else): leave it.
    return jsonb_build_object('ok', true, 'already_owned', true, 'store_id', v_id);
  end if;

  update stores
     set owner_email = v_email
   where id = v_id
     and coalesce(trim(owner_email), '') = '';

  return jsonb_build_object('ok', true, 'already_owned', false, 'store_id', v_id);
end;
$$;

revoke all on function verafo_set_store_owner(text, text) from public, anon;
grant execute on function verafo_set_store_owner(text, text) to service_role;

-- ── Backfill: stores that already have orders but no owner ──
-- Prints what is stuck. Nothing is changed here on purpose: the right owner is
-- a person, and that decision belongs to whoever runs this.
select s.id,
       s.shopify_domain,
       s.owner_email,
       (select count(*) from orders o where o.store_id = s.id) as orders
from stores s
where coalesce(trim(s.owner_email), '') = ''
  and s.shopify_domain is not null
order by orders desc;

-- To connect one to a merchant account right now:
--   update stores set owner_email = lower('<their-login-email>')
--    where shopify_domain = 'their-store.myshopify.com';
-- …or let them press "Connect" on the dashboard banner / Settings card, which
-- calls verafo_claim_store and is the path you want them to use.

notify pgrst, 'reload schema';
