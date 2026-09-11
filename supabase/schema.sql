-- ============================================================
-- Verafo MVP — Supabase schema
-- Run this in the Supabase SQL editor, then optionally seed.sql
-- ============================================================

-- Enable the vector extension (for AI embeddings)
create extension if not exists vector;

-- 1. STORES — each connected seller
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_email text,
  created_at timestamptz default now()
);

-- 2. BUYERS — one row per unique phone number (the anchor of everything)
create table buyers (
  phone text primary key,                 -- the key that ties all data together
  first_seen timestamptz default now(),
  total_orders int default 0,
  total_accepted int default 0,
  total_refused int default 0,
  risk_score numeric default 0.5,         -- 0 = safe, 1 = high risk. starts neutral.
  embedding vector(1536),                 -- the AI behavioural fingerprint (nullable until enough history)
  feature_vector real[],                  -- raw MVP feature vector (see features-migration.sql)
  updated_at timestamptz default now()
);

-- 3. ORDERS — every order placed, the core behavioural log
create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_phone text references buyers(phone),
  store_id uuid references stores(id),
  product_category text,                  -- e.g. "skincare", "clothing", "electronics"
  product_name text,
  price numeric,
  quantity int default 1,
  address text,
  city text,
  ordered_at timestamptz default now()
);

-- 4. OUTCOMES — what happened to each order (the risk signal)
create table outcomes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) unique,
  status text check (status in ('accepted','refused','pending')) default 'pending',
  refusal_reason text,                    -- optional, phase 2
  delivery_attempts int default 1,
  resolved_at timestamptz
);

create index orders_buyer_phone_idx on orders (buyer_phone);
create index orders_store_id_idx on orders (store_id);
create index outcomes_status_idx on outcomes (status);

-- 5. LOOKUPS — every buyer profile viewed (powers "Recent lookups")
create table lookups (
  id uuid primary key default gen_random_uuid(),
  buyer_phone text references buyers(phone),
  owner_email text,                       -- who searched (scoped per-user once RLS is on; see rls-production.sql)
  searched_at timestamptz default now()
);

create index lookups_searched_at_idx on lookups (searched_at desc);

-- 6. CHATS — Ask Verafo conversations (multi-chat workspace)
create table chats (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  phone text references buyers(phone),
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 7. CHAT_MESSAGES — message history inside each chat
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  phone text,
  created_at timestamptz default now()
);

create index chats_last_message_at_idx on chats (last_message_at desc nulls last);
create index chat_messages_chat_id_idx on chat_messages (chat_id, created_at);

-- ============================================================
-- Rule-based risk score (v0)
-- ============================================================
create or replace function recompute_buyer(p_phone text)
returns buyers
language plpgsql
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

-- Keep buyer totals + score fresh automatically
create or replace function on_order_change()
returns trigger
language plpgsql
as $$
begin
  perform recompute_buyer(new.buyer_phone);
  return new;
end;
$$;

create or replace function on_outcome_change()
returns trigger
language plpgsql
as $$
declare
  v_phone text;
begin
  select buyer_phone into v_phone from orders where id = coalesce(new.order_id, old.order_id);
  if v_phone is not null then
    perform recompute_buyer(v_phone);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_order_recompute on orders;
create trigger trg_order_recompute
after insert on orders
for each row execute function on_order_change();

drop trigger if exists trg_outcome_recompute on outcomes;
create trigger trg_outcome_recompute
after insert or update of status on outcomes
for each row execute function on_outcome_change();

-- ============================================================
-- pgvector nearest-neighbour search (v1, used by Buyer Lookup)
-- ============================================================
create or replace function find_similar_buyers(p_embedding vector(1536), p_limit int default 5)
returns table (
  phone text,
  risk_score numeric,
  total_orders int,
  total_refused int,
  similarity real
)
language sql
stable
as $$
  select phone, risk_score, total_orders, total_refused,
         (embedding <=> p_embedding) as similarity
  from buyers
  where embedding is not null
  order by embedding <-> p_embedding
  limit p_limit;
$$;

-- ============================================================
-- Row-level security
-- MVP demo: the anon key may read/write everything.
-- For production, replace with authenticated-role policies
-- (e.g. one policy per store owner) before shipping.
-- ============================================================
alter table stores enable row level security;
alter table buyers enable row level security;
alter table orders enable row level security;
alter table outcomes enable row level security;
alter table lookups enable row level security;
alter table chats enable row level security;
alter table chat_messages enable row level security;

create policy "demo anon stores" on stores for all to anon using (true) with check (true);
create policy "demo anon buyers" on buyers for all to anon using (true) with check (true);
create policy "demo anon orders" on orders for all to anon using (true) with check (true);
create policy "demo anon outcomes" on outcomes for all to anon using (true) with check (true);
create policy "demo anon lookups" on lookups for all to anon using (true) with check (true);
create policy "demo anon chats" on chats for all to anon using (true) with check (true);
create policy "demo anon chat_messages" on chat_messages for all to anon using (true) with check (true);

grant execute on function recompute_buyer(text) to anon;
grant execute on function find_similar_buyers(vector, int) to anon;
