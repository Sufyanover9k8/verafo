-- ============================================================
-- Private chats: scope Ask Verafo conversations to their owner
--
-- THE HOLE THIS CLOSES. `chats` and `chat_messages` had no owner column and
-- these policies:
--
--   create policy "chats all" on chats for all to authenticated using (true)
--   create policy "chat_messages all" on chat_messages for all to authenticated using (true)
--
-- `using (true)` means EVERY signed-in user could read, update and delete EVERY
-- chat. A merchant opening Ask Verafo saw other merchants' conversations in
-- "Conversations", could open them, and those transcripts contain buyer phone
-- numbers, order history and risk analysis. The old file even flagged it:
-- "no owner column yet. Permissive for now."
--
-- Rows created before this migration cannot be attributed to anyone, so they
-- keep a NULL owner and become invisible to merchants. Administrators keep
-- access for support.
--
-- Run in the Supabase SQL editor, after rls-production.sql.
-- Idempotent.
-- ============================================================

begin;

alter table chats add column if not exists owner_email text;

-- Default the owner at write time. This is the belt-and-braces half: even a
-- client that forgets to send owner_email cannot create an orphan chat that
-- later leaks to someone else.
alter table chats alter column owner_email set default verafo_current_email();

create index if not exists chats_owner_email_idx on chats (lower(owner_email));

-- ── chats ───────────────────────────────────────────────────
drop policy if exists "chats all" on chats;
drop policy if exists "chats read own" on chats;
drop policy if exists "chats insert own" on chats;
drop policy if exists "chats update own" on chats;
drop policy if exists "chats delete own" on chats;

create policy "chats read own" on chats for select to authenticated
  using (verafo_is_admin() or lower(coalesce(owner_email, '')) = verafo_current_email());

create policy "chats insert own" on chats for insert to authenticated
  with check (verafo_is_admin() or lower(coalesce(owner_email, '')) = verafo_current_email());

create policy "chats update own" on chats for update to authenticated
  using (verafo_is_admin() or lower(coalesce(owner_email, '')) = verafo_current_email())
  with check (verafo_is_admin() or lower(coalesce(owner_email, '')) = verafo_current_email());

create policy "chats delete own" on chats for delete to authenticated
  using (verafo_is_admin() or lower(coalesce(owner_email, '')) = verafo_current_email());

-- ── chat_messages ───────────────────────────────────────────
-- A message has no owner of its own; it inherits its parent chat's. The policy
-- therefore has to look through the chat, and it must do so for writes too, or
-- a caller could append to somebody else's transcript.
drop policy if exists "chat_messages all" on chat_messages;
drop policy if exists "chat_messages own" on chat_messages;

create policy "chat_messages own" on chat_messages for all to authenticated
  using (
    exists (
      select 1 from chats c
      where c.id = chat_messages.chat_id
        and (
          verafo_is_admin()
          or lower(coalesce(c.owner_email, '')) = verafo_current_email()
        )
    )
  )
  with check (
    exists (
      select 1 from chats c
      where c.id = chat_messages.chat_id
        and (
          verafo_is_admin()
          or lower(coalesce(c.owner_email, '')) = verafo_current_email()
        )
    )
  );

commit;

-- Verification: as a merchant, `select count(*) from chats;` must only ever
-- return your own rows, and `select * from chats;` must not reveal another
-- merchant's titles or buyer phone numbers.
