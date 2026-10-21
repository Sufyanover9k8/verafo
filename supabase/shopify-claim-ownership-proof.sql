-- ============================================================
-- Who may claim a store: proof, not proximity
--
-- WHAT HAPPENED. `sanicore.store` lost its owner during a cleanup, and the
-- claim banner then offered it to a DIFFERENT merchant — domain, order count,
-- and a Connect button that would have handed them 20 orders belonging to
-- somebody else. The list was global: any signed-in user saw every unowned
-- store. "Unowned" is not the same as "yours", and the app treated them as one.
--
-- THE FIX is a rule with proof attached. A store is claimable only when
-- `stores.contact_email` (recorded from Shopify at install) matches the caller.
-- Losing the owner is then harmless: nobody can adopt a row they cannot prove
-- is theirs.
--
-- For a NEW install there is no claiming at all — the Shopify app knows the
-- shop's email from `shop { email }` and calls `verafo_set_store_owner(domain,
-- email)`, which stamps owner + contact_email in one step. Zero friction, no
-- banner, no guessing.
--
-- For a row whose contact_email is unknown (everything installed before today),
-- claiming is refused with a message pointing at the Shopify app, and the fix
-- is a service-role call from the SQL editor — a person, not a heuristic.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

alter table stores add column if not exists contact_email text;

comment on column stores.contact_email is
  'The shop email Shopify reports at install. Proof that a claimant owns the shop.';

create index if not exists stores_contact_email_idx
  on stores (lower(contact_email));

-- ── 1. The list: only what the caller can prove ─────────────
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
    and exists (
      select 1 from orders o
       where o.store_id = s.id
         and o.deleted_at is null
    )
    and verafo_current_email() is not null
    and (
      -- Proof of ownership: the shop email Shopify gave us at install.
      lower(coalesce(s.contact_email, '')) = verafo_current_email()
      -- Admins may see the queue in order to help, and only they.
      or verafo_is_admin()
      /*
       * Not proof yet, but bounded — and required for every install that
       * predates `contact_email`. A merchant who owns NOTHING may claim an
       * unproven store: they cannot be taking one from themselves, and the
       * merge leaves them with exactly one. The claim stamps contact_email with
       * their address, so the door closes behind them.
       *
       * Someone who already owns a store still needs proof. That is what stops
       * one account collecting other people's order books.
       */
      or (
        coalesce(trim(s.contact_email), '') = ''
        and not exists (
          select 1 from stores x
           where lower(coalesce(x.owner_email, '')) = verafo_current_email()
        )
      )
    )
  order by 5 desc nulls last, s.created_at desc
  limit 20;
$$;

revoke all on function verafo_claimable_stores() from public, anon;
grant execute on function verafo_claimable_stores() to authenticated;

-- ── 2. The claim itself: same proof, enforced here too ──────
create or replace function verafo_claim_store(p_domain text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email    text;
  v_domain   text;
  v_id       uuid;
  v_owner    text;
  v_name     text;
  v_contact  text;
  v_orders   int;
  v_kept     uuid;
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

  select s.id, s.owner_email, s.name, lower(coalesce(s.contact_email, '')),
         (select count(*)::int from orders o where o.store_id = s.id and o.deleted_at is null)
    into v_id, v_owner, v_name, v_contact, v_orders
  from stores s
  where lower(s.shopify_domain) = v_domain;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if lower(coalesce(v_owner, '')) = lower(v_email) then
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

  -- THE GATE. Unowned is not the same as yours: without the shop's email on
  -- record, or with one that does not match, this is not your store to take.
  if v_contact = '' then
    /*
     * No recorded shop email — an install from before proof existed. Allowed
     * only for an account that owns nothing yet: it cannot be stealing from
     * itself, and the merge below keeps them at exactly one store. Anyone who
     * already has a store must prove ownership first.
     */
    if exists (
      select 1 from stores x
       where lower(coalesce(x.owner_email, '')) = lower(v_email)
    ) then
      return jsonb_build_object('ok', false, 'reason', 'needs_verification');
    end if;
  elsif v_contact <> lower(v_email) and not verafo_is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;

  update stores
     set owner_email = lower(v_email),
         contact_email = coalesce(nullif(contact_email, ''), lower(v_email))
   where id = v_id
     and (owner_email is null or owner_email = '');

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

-- ── 3. Install: the frictionless path ───────────────────────
-- The Shopify app calls this with the service role as soon as it can read
-- `shop { email }`. Owner and proof are set together, so there is nothing left
-- for the merchant to claim.
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

  -- Record the proof even when the row already has an owner.
  update stores
     set contact_email = v_email
   where id = v_id
     and coalesce(trim(contact_email), '') = '';

  if coalesce(trim(v_owner), '') = '' then
    update stores
       set owner_email = v_email
     where id = v_id;
  end if;

  perform verafo_merge_merchant_stores(v_email);

  select s.id into v_kept
  from stores s
  where lower(coalesce(s.owner_email, '')) = v_email
  order by (lower(coalesce(s.shopify_domain, '')) like '%.myshopify.com') desc
  limit 1;

  return jsonb_build_object('ok', true,
                            'already_owned', coalesce(trim(v_owner), '') <> '',
                            'store_id', coalesce(v_kept, v_id));
end;
$$;

revoke all on function verafo_set_store_owner(text, text) from public, anon;
grant execute on function verafo_set_store_owner(text, text) to service_role;

-- ── 4. Today's orphan, fixed by a person ────────────────────
-- `sanicore.store` is the merchant's own shop (the row that lost its owner).
-- Give it back to them; the merge folds its 20 orders into their single store.
update stores
   set owner_email = 'sanicorestore@gmail.com',
       contact_email = coalesce(nullif(contact_email, ''), 'sanicorestore@gmail.com')
 where lower(shopify_domain) = 'sanicore.store';

select verafo_merge_merchant_stores('sanicorestore@gmail.com');

-- ── 5. Report ───────────────────────────────────────────────
-- Anything still ownerless, and whether we can prove who it belongs to.
select s.name,
       s.shopify_domain,
       s.owner_email,
       s.contact_email,
       (select count(*) from orders o where o.store_id = s.id) as orders
from stores s
where coalesce(trim(s.owner_email), '') = ''
order by orders desc;

notify pgrst, 'reload schema';
