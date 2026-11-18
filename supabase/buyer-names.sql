-- ============================================================================
-- Buyer names.
--
-- `buyers` is keyed by phone and never had a name column, so screens could only
-- ever show a number. Courier reports do carry the consignee's name, which is
-- the natural place to learn it, so store it here once and show it everywhere.
--
-- Names are personal data like the phone number already is, and RLS on `buyers`
-- is unchanged: a merchant still only sees buyers through their own orders.
-- ============================================================================

alter table public.buyers add column if not exists name text;

comment on column public.buyers.name is
  'Consignee/customer name, learned from courier reports. Null when unknown.';

-- Backfill from the only place a name was ever recorded (Shopify fulfilment).
update public.buyers b
set name = src.customer_name
from (
  select distinct on (o.buyer_phone)
         o.buyer_phone,
         trim(f.customer_name) as customer_name
  from public.order_fulfillment f
  join public.orders o on o.id = f.order_id
  where f.customer_name is not null
    and length(trim(f.customer_name)) > 1
  order by o.buyer_phone, f.updated_at desc nulls last
) src
where b.phone = src.buyer_phone
  and (b.name is null or b.name = '');

create index if not exists buyers_name_idx on public.buyers (phone) where name is not null;
