-- ============================================================
-- Verafo MVP — demo seed data (run after schema.sql)
-- Three stores, five buyers: a network of real-looking behaviour.
-- Phones are stored compact (no spaces) — the frontend normalises
-- what you type, so "+92 300 111 2222" and "+923001112222" match.
-- ============================================================

insert into stores (name, owner_email) values
  ('Sanicore', 'sanicore@verafo.demo'),
  ('Crescent Beauty', 'crescent@verafo.demo'),
  ('Urban Threads', 'urban@verafo.demo')
on conflict do nothing;

-- ------------------------------------------------------------
-- Buyer A — HIGH RISK: 8 orders, 6 refused, across 2 stores
-- ------------------------------------------------------------
insert into buyers (phone, first_seen) values ('+923001112222', now() - interval '45 days') on conflict (phone) do nothing;

insert into orders (buyer_phone, store_id, product_category, product_name, price, quantity, address, city, ordered_at)
values
  ('+923001112222', (select id from stores where name = 'Sanicore'), 'skincare',   'Vitamin C serum 30ml',      2499, 1, 'House 12, Block B, Model Town',      'Lahore',   now() - interval '32 days'),
  ('+923001112222', (select id from stores where name = 'Sanicore'), 'skincare',   'Face wash 150ml',             899, 2, 'House 12, Block B, Model Town',      'Lahore',   now() - interval '28 days'),
  ('+923001112222', (select id from stores where name = 'Sanicore'), 'skincare',   'Sunscreen SPF 50',           1699, 1, 'House 12, Block B, Model Town',      'Lahore',   now() - interval '24 days'),
  ('+923001112222', (select id from stores where name = 'Sanicore'), 'skincare',   'Night repair cream',         3499, 1, 'House 12, Block B, Model Town',      'Lahore',   now() - interval '19 days'),
  ('+923001112222', (select id from stores where name = 'Sanicore'), 'beauty',     'Makeup remover set',         1499, 1, 'Flat 3, Gulberg 3',                   'Lahore',   now() - interval '15 days'),
  ('+923001112222', (select id from stores where name = 'Crescent Beauty'), 'skincare', 'Hair serum argan',    1899, 1, 'Flat 3, Gulberg 3',                   'Lahore',   now() - interval '11 days'),
  ('+923001112222', (select id from stores where name = 'Crescent Beauty'), 'skincare', 'Body lotion shea',     1299, 1, 'House 7, DHA Phase 6',                 'Lahore',   now() - interval '6 days'),
  ('+923001112222', (select id from stores where name = 'Crescent Beauty'), 'beauty',   'Lipstick set of 4',    2199, 1, 'House 7, DHA Phase 6',                 'Lahore',   now() - interval '2 days');

insert into outcomes (order_id, status, delivery_attempts, resolved_at)
select o.id, s.status, 1, o.ordered_at + interval '2 days'
from orders o
join (values
  ('Vitamin C serum 30ml',    'refused'),
  ('Face wash 150ml',         'accepted'),
  ('Sunscreen SPF 50',        'refused'),
  ('Night repair cream',      'refused'),
  ('Makeup remover set',      'accepted'),
  ('Hair serum argan',        'refused'),
  ('Body lotion shea',        'refused'),
  ('Lipstick set of 4',       'refused')
) as s(product_name, status) on s.product_name = o.product_name
where o.buyer_phone = '+923001112222';

-- ------------------------------------------------------------
-- Buyer B — TRUSTED: 12 orders, 1 refused, across 3 stores
-- ------------------------------------------------------------
insert into buyers (phone, first_seen) values ('+923214445555', now() - interval '90 days') on conflict (phone) do nothing;

insert into orders (buyer_phone, store_id, product_category, product_name, price, quantity, address, city, ordered_at)
values
  ('+923214445555', (select id from stores where name = 'Sanicore'),        'skincare',   'Hyaluronic serum',          2299, 1, 'Street 4, Johar Town',          'Lahore',   now() - interval '62 days'),
  ('+923214445555', (select id from stores where name = 'Sanicore'),        'skincare',   'Moisturiser 100ml',         1799, 1, 'Street 4, Johar Town',          'Lahore',   now() - interval '58 days'),
  ('+923214445555', (select id from stores where name = 'Sanicore'),        'skincare',   'Toner rose water',          999,  2, 'Street 4, Johar Town',          'Lahore',   now() - interval '53 days'),
  ('+923214445555', (select id from stores where name = 'Sanicore'),        'skincare',   'Gentle cleanser',           1249, 1, 'Street 4, Johar Town',          'Lahore',   now() - interval '47 days'),
  ('+923214445555', (select id from stores where name = 'Sanicore'),        'skincare',   'Clay face mask',            1399, 1, 'Street 4, Johar Town',          'Lahore',   now() - interval '41 days'),
  ('+923214445555', (select id from stores where name = 'Crescent Beauty'), 'beauty',     'Eyeliner set',              1199, 1, 'House 9, Cavalry Ground',       'Lahore',   now() - interval '35 days'),
  ('+923214445555', (select id from stores where name = 'Crescent Beauty'), 'beauty',     'Foundation kit',            2899, 1, 'House 9, Cavalry Ground',       'Lahore',   now() - interval '30 days'),
  ('+923214445555', (select id from stores where name = 'Crescent Beauty'), 'haircare',   'Hair oil argan 100ml',      1599, 1, 'House 9, Cavalry Ground',       'Lahore',   now() - interval '26 days'),
  ('+923214445555', (select id from stores where name = 'Crescent Beauty'), 'beauty',     'Nail polish duo',            899,  1, 'House 9, Cavalry Ground',       'Lahore',   now() - interval '21 days'),
  ('+923214445555', (select id from stores where name = 'Urban Threads'),   'clothing',   'Cotton t-shirt',            1199, 2, 'PECHS Block 2',                 'Karachi',  now() - interval '16 days'),
  ('+923214445555', (select id from stores where name = 'Urban Threads'),   'clothing',   'Slim jeans',                2499, 1, 'PECHS Block 2',                 'Karachi',  now() - interval '11 days'),
  ('+923214445555', (select id from stores where name = 'Urban Threads'),   'clothing',   'Oversized hoodie',          1999, 1, 'PECHS Block 2',                 'Karachi',  now() - interval '5 days');

insert into outcomes (order_id, status, delivery_attempts, resolved_at)
select o.id, s.status, 1, o.ordered_at + interval '1 day'
from orders o
join (values
  ('Hyaluronic serum', 'accepted'),
  ('Moisturiser 100ml','accepted'),
  ('Toner rose water', 'accepted'),
  ('Gentle cleanser',  'accepted'),
  ('Clay face mask',   'accepted'),
  ('Eyeliner set',     'accepted'),
  ('Foundation kit',   'accepted'),
  ('Hair oil argan 100ml', 'refused'),
  ('Nail polish duo',  'accepted'),
  ('Cotton t-shirt',   'accepted'),
  ('Slim jeans',       'accepted'),
  ('Oversized hoodie', 'accepted')
) as s(product_name, status) on s.product_name = o.product_name
where o.buyer_phone = '+923214445555';

-- ------------------------------------------------------------
-- Buyer C — NEW TODAY: 1 pending order, seen for the first time
-- ------------------------------------------------------------
insert into buyers (phone, first_seen) values ('+923337778888', now()) on conflict (phone) do nothing;

insert into orders (buyer_phone, store_id, product_category, product_name, price, quantity, address, city, ordered_at)
values
  ('+923337778888', (select id from stores where name = 'Sanicore'), 'skincare', 'Retinol cream 30ml', 2699, 1, 'House 2, F-11 Markaz', 'Islamabad', now() - interval '3 hours');

-- no outcome row yet → appears as pending in Mark Outcome

-- ------------------------------------------------------------
-- Buyer D — CAUTION: 4 orders, 2 refused, single store
-- ------------------------------------------------------------
insert into buyers (phone, first_seen) values ('+923459990000', now() - interval '20 days') on conflict (phone) do nothing;

insert into orders (buyer_phone, store_id, product_category, product_name, price, quantity, address, city, ordered_at)
values
  ('+923459990000', (select id from stores where name = 'Sanicore'), 'electronics', 'Bluetooth earbuds',      3499, 1, 'Flat 4, Clifton Block 5',     'Karachi',  now() - interval '18 days'),
  ('+923459990000', (select id from stores where name = 'Sanicore'), 'electronics', 'Power bank 20000mAh',    2799, 1, 'Flat 4, Clifton Block 5',     'Karachi',  now() - interval '13 days'),
  ('+923459990000', (select id from stores where name = 'Sanicore'), 'electronics', 'Smart watch',             8999, 1, 'Flat 4, Clifton Block 5',     'Karachi',  now() - interval '8 days'),
  ('+923459990000', (select id from stores where name = 'Sanicore'), 'electronics', 'Portable speaker',        4999, 1, 'Flat 4, Clifton Block 5',     'Karachi',  now() - interval '3 days');

insert into outcomes (order_id, status, delivery_attempts, resolved_at)
select o.id, s.status, 1, o.ordered_at + interval '2 days'
from orders o
join (values
  ('Bluetooth earbuds',   'accepted'),
  ('Power bank 20000mAh', 'accepted'),
  ('Smart watch',         'refused'),
  ('Portable speaker',    'refused')
) as s(product_name, status) on s.product_name = o.product_name
where o.buyer_phone = '+923459990000';

-- ------------------------------------------------------------
-- Buyer E — UNKNOWN: a profile row with zero history
-- ------------------------------------------------------------
insert into buyers (phone, first_seen) values ('+923125556666', now()) on conflict (phone) do nothing;

-- ------------------------------------------------------------
-- Recent lookups — starter history for the Buyer Lookup panel
-- ------------------------------------------------------------
insert into lookups (buyer_phone, searched_at) values
  ('+923459990000', now() - interval '26 minutes'),
  ('+923214445555', now() - interval '2 hours'),
  ('+923001112222', now() - interval '5 hours'),
  ('+923125556666', now() - interval '1 day');

-- ------------------------------------------------------------
-- Final safety pass: recompute every buyer from source of truth
-- ------------------------------------------------------------
do $$
declare r record;
begin
  for r in select phone from buyers loop
    perform recompute_buyer(r.phone);
  end loop;
end $$;

select phone, risk_score, total_orders, total_accepted, total_refused
from buyers order by risk_score desc;
