-- ============================================================
-- One merchant, one store: consolidate the Sanicore duplicate
--
-- WHAT THE DATA SHOWS
--
--   Sanicore                 | sanicore.store            | the-merchant-email-they-sign-in-with | 20
--   Orjbqb-uk.myshopify.com  | orjbqb-uk.myshopify.com   | sanicorestore@gmail.com              | 12
--
-- Two problems, both real:
--
-- 1. The first row's owner is the literal placeholder text from an instruction,
--    not an email. RLS matches `owner_email` to the signed-in user, so those 20
--    orders are readable by nobody — the dashboard looks brand new.
--
-- 2. Two rows exist because they are keyed differently. The merchant's own row
--    carries the custom domain `sanicore.store`; the Shopify app can only ever
--    see the myshopify handle `orjbqb-uk.myshopify.com`, so it created its own
--    row instead of matching. One merchant, two stores.
--
-- THE FIX keeps the row the Shopify app writes to and makes it the merchant's
-- store: rename it, give it the real owner, move the other row's orders across,
-- then release the now-empty duplicate. The app's own cached mapping stays
-- valid, because its store id is the one we keep — deleting it would make every
-- future webhook fail on a missing foreign key.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

do $$
declare
  v_shop_id    uuid;
  v_other_id   uuid;
  v_merchant   text := 'sanicorestore@gmail.com';   -- the account that signs in
  v_keep_name  text := 'Sanicore';                  -- what the merchant should see
  v_shop_dom   text := 'orjbqb-uk.myshopify.com';   -- what the app writes to
  v_other_dom  text := 'sanicore.store';            -- the row to release
  v_moved      int := 0;
begin
  select id into v_shop_id from stores where lower(shopify_domain) = v_shop_dom;
  select id into v_other_id from stores where lower(shopify_domain) = v_other_dom;

  if v_shop_id is null then
    raise notice 'No store for %, nothing to do.', v_shop_dom;
    return;
  end if;

  -- 1. The Shopify row becomes the merchant's store: real name, real owner.
  update stores
     set name = v_keep_name,
         owner_email = lower(v_merchant)
   where id = v_shop_id;

  -- 2. Move the other row's orders onto it, so history is not stranded.
  if v_other_id is not null and v_other_id <> v_shop_id then
    update orders
       set store_id = v_shop_id
     where store_id = v_other_id;
    get diagnostics v_moved = row_count;

    -- 3. Release the duplicate: un-own rather than delete, so nothing that
    --    references it (plans, audit rows) can break.
    update stores
       set owner_email = null
     where id = v_other_id
       and not exists (select 1 from orders o where o.store_id = v_other_id);
  end if;

  raise notice 'Consolidated: % order(s) moved onto % (store %).',
    v_moved, v_shop_dom, v_shop_id;
end;
$$;

-- Any other row still carrying the placeholder text: release it, so it cannot
-- keep hiding orders behind an "owner" that is not an email.
update stores
   set owner_email = null
 where lower(coalesce(owner_email, '')) = 'the-merchant-email-they-sign-in-with';

-- Result: one store per merchant, with the orders attached to the one the
-- Shopify app keeps writing to.
select s.name,
       s.shopify_domain,
       s.owner_email,
       (select count(*) from orders o where o.store_id = s.id) as orders
from stores s
where s.owner_email is not null and s.owner_email <> ''
order by s.name;
