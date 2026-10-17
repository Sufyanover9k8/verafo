-- ============================================================
-- Verafo — merchant decisions on orders (the Decide Queue)
--
-- WHY A SEPARATE TABLE
-- `outcomes` records what actually happened at the door: accepted,
-- refused, pending. That is the delivery fact, and it feeds the risk
-- score. A *decision* is a different thing: what the merchant chose to
-- do before shipping ("ship anyway", "hold for review"). Keeping them
-- apart means a merchant action can never be mistaken for a delivery
-- result, and the scoring pipeline is untouched.
--
-- Decisions are append-only: every action writes a new row, so the
-- history is the audit trail. Nothing here updates or deletes.
--
-- SAFE TO RUN: creates one new table and one index. It reads no
-- existing table and modifies nothing that already exists.
--
-- This file is NOT part of the buyer-privacy release (stage A/C). The
-- hardening pass only added, at the bottom: anon loses every privilege on
-- the table, and `note` is capped at 500 characters.
--
-- Run in the Supabase SQL Editor, after supabase/schema.sql.
-- Rollback is at the bottom of this file.
-- ============================================================

begin;

create table if not exists order_decisions (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  -- What the merchant chose to do.
  decision      text not null check (decision in (
                  'confirm_whatsapp',  -- asked the buyer to confirm
                  'call',              -- phoned the buyer
                  'hold',              -- parked it for later
                  'ship'               -- shipping despite the risk
                )),
  -- Who did it. The signed-in email, written by the client under RLS
  -- and enforced by the policy below, so it can never be spoofed for
  -- someone else's store.
  actor_email   text,
  note          text,
  created_at    timestamptz not null default now()
);

-- The queue reads the latest decision per order, newest first.
create index if not exists order_decisions_order_created_idx
  on order_decisions (order_id, created_at desc);

-- Finding everything one merchant decided, for the audit view.
create index if not exists order_decisions_actor_idx
  on order_decisions (lower(coalesce(actor_email, '')));

alter table order_decisions enable row level security;

-- ── Read ────────────────────────────────────────────────────
-- A decision is visible only when the order belongs to one of the
-- signed-in merchant's own stores. The email comparison mirrors
-- verafo_current_email() from rls-production.sql, written inline so
-- this file does not depend on that migration having run.
drop policy if exists "order_decisions read own" on order_decisions;
create policy "order_decisions read own" on order_decisions for select to authenticated
  using (
    exists (
      select 1
      from orders o
      join stores s on s.id = o.store_id
      where o.id = order_decisions.order_id
        and coalesce(auth.jwt() ->> 'email', '') <> ''
        and lower(coalesce(s.owner_email, '')) = lower(auth.jwt() ->> 'email')
    )
  );

-- ── Insert ──────────────────────────────────────────────────
-- A merchant may record a decision only against their own order, and
-- only under their own email. `with check` enforces the actor, so a
-- tampered client cannot attribute a decision to another user, and
-- cannot write against another tenant's order.
drop policy if exists "order_decisions insert own" on order_decisions;
create policy "order_decisions insert own" on order_decisions for insert to authenticated
  with check (
    lower(coalesce(actor_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce(auth.jwt() ->> 'email', '') <> ''
    and exists (
      select 1
      from orders o
      join stores s on s.id = o.store_id
      where o.id = order_decisions.order_id
        and lower(coalesce(s.owner_email, '')) = lower(auth.jwt() ->> 'email')
    )
  );

-- Deliberately NO update and NO delete policy. The history is the audit
-- trail: a decision that was made stays recorded. Only the service role
-- (which bypasses RLS) could ever change a row.

grant select, insert on order_decisions to authenticated;

-- ── anon ────────────────────────────────────────────────────
-- Every client in this product is signed in. anon has no business reading
-- or writing a merchant's decisions.
revoke all on order_decisions from anon;

-- ── note: 500 characters, enforced ──────────────────────────
-- `note` is free text a merchant types. Capping it keeps a decision (and the
-- audit trail built from it) from becoming an unbounded paste target.
-- Existing rows are checked first: if a legacy note is longer, this fails
-- with the count instead of half-applying the constraint. Fix them with
--   update order_decisions set note = left(note, 500) where length(note) > 500;
-- and re-run this file.
do $$
declare
  v_long int;
begin
  select count(*) into v_long from order_decisions where length(coalesce(note, '')) > 500;
  if v_long > 0 then
    raise exception 'order-decisions: % row(s) already have a note longer than 500 characters. Shorten them, then re-run.', v_long;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'order_decisions_note_max_len'
      and conrelid = 'order_decisions'::regclass
  ) then
    alter table order_decisions
      add constraint order_decisions_note_max_len
      check (note is null or length(note) <= 500);
  end if;
end $$;

commit;

-- ============================================================
-- ROLLBACK — paste this to remove the feature's schema
-- ============================================================
-- begin;
-- alter table order_decisions drop constraint if exists order_decisions_note_max_len;
-- grant all on order_decisions to anon;
-- drop policy if exists "order_decisions read own" on order_decisions;
-- drop policy if exists "order_decisions insert own" on order_decisions;
-- drop table if exists order_decisions;
-- commit;
