-- Run this in the Supabase SQL editor (or via the Management API) to add the
-- Ask Verafo multi-chat workspace tables.

create table chats (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  phone text references buyers(phone),
  last_message text,
  last_message_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

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

alter table chats enable row level security;
alter table chat_messages enable row level security;

create policy "demo anon chats" on chats for all to anon using (true) with check (true);
create policy "demo anon chat_messages" on chat_messages for all to anon using (true) with check (true);

-- starter conversations so the chat list isn't empty
insert into chats (title, phone, last_message, last_message_at) values
  ('Trust check: +923214445555', '+923214445555',
   'Verafo: Low risk (0.0). 12 orders, only 1 refusal across 3 stores. You can ship this order.',
   now() - interval '2 hours'),
  ('Refusal pattern @ +923001112222', '+923001112222',
   'Verafo: High risk (0.75) - 6 of 8 orders refused. Ship only with prepayment or phone verification.',
   now() - interval '1 day');

insert into chat_messages (chat_id, role, content, phone) values
  ((select id from chats order by last_message_at desc limit 1), 'user',
   'Should I ship an order to @+923214445555?', '+923214445555'),
  ((select id from chats order by last_message_at desc limit 1), 'assistant',
   'Low risk (0.0). 12 orders, only 1 refusal across 3 stores. You can ship this order safely.', '+923214445555'),
  ((select id from chats order by last_message_at asc limit 1), 'user',
   'Is @+923001112222 safe to ship to again?', '+923001112222'),
  ((select id from chats order by last_message_at asc limit 1), 'assistant',
   'High risk (0.75) — 6 of 8 orders refused. Ship only with prepayment or phone verification.', '+923001112222');
