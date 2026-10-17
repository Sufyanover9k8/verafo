-- ============================================================
-- Notifications
--
-- One row per recipient, not a broadcast row with an audience column, because
-- read state is per person: a single row shared by every merchant could only
-- ever be "read by whoever opened it first".
--
-- Rows are written ONLY by the SECURITY DEFINER functions below and by a
-- trigger on `outcomes`. There is deliberately no INSERT policy, so a signed-in
-- user cannot mint a notification for anyone — including themselves, which is
-- what stops a merchant impersonating an admin announcement.
--
-- Run in the Supabase SQL editor. Idempotent.
-- ============================================================

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  -- outcome | daily | admin
  kind text not null default 'admin',
  title text not null,
  body text,
  -- In-app route to open, e.g. /orders/pending
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_owner_idx
  on notifications (lower(owner_email), created_at desc);
create index if not exists notifications_unread_idx
  on notifications (lower(owner_email)) where read_at is null;

alter table notifications enable row level security;

drop policy if exists "notifications read own" on notifications;
create policy "notifications read own" on notifications for select to authenticated
  using (lower(owner_email) = verafo_current_email() or verafo_is_admin());

-- Marking read is an UPDATE of one's own rows. Admins are NOT given this: an
-- admin clearing a merchant's unread badge would be a silent act on their inbox.
drop policy if exists "notifications update own" on notifications;
create policy "notifications update own" on notifications for update to authenticated
  using (lower(owner_email) = verafo_current_email())
  with check (lower(owner_email) = verafo_current_email());

-- ── Admin broadcast ─────────────────────────────────────────
create or replace function verafo_send_notification(
  p_title text,
  p_body text default null,
  p_link text default null,
  p_all boolean default false,
  p_email text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_email text;
begin
  if not verafo_is_admin() then
    raise exception 'Only an administrator can send notifications' using errcode = '42501';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'A title is required' using errcode = '22023';
  end if;

  if p_all then
    -- Everyone who can sign in and see Verafo: every store owner, plus the
    -- Verafo team itself. Identity lives in those two tables, so this is the
    -- full audience.
    insert into notifications (owner_email, kind, title, body, link)
    select distinct e, 'admin', p_title, p_body, p_link
    from (
      select lower(trim(s.owner_email)) as e
      from stores s
      where coalesce(trim(s.owner_email), '') <> ''
      union
      select lower(trim(a.email)) as e
      from verafo_admins a
      where coalesce(trim(a.email), '') <> ''
    ) recipients;
    get diagnostics v_count = row_count;
  else
    v_email := lower(coalesce(p_email, verafo_current_email()));
    if v_email is null then
      raise exception 'No recipient' using errcode = '22023';
    end if;
    insert into notifications (owner_email, kind, title, body, link)
    values (v_email, 'admin', p_title, p_body, p_link);
    v_count := 1;
  end if;

  return v_count;
end;
$$;

revoke all on function verafo_send_notification(text, text, text, boolean, text) from public, anon;
grant execute on function verafo_send_notification(text, text, text, boolean, text) to authenticated;

-- ── Daily digest ────────────────────────────────────────────
-- Called by the app on load. It writes AT MOST ONE digest per user per day, so
-- a refresh loop cannot spam the bell; returns 0 when it had nothing to say.
create or replace function verafo_daily_digest()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := verafo_current_email();
  v_orders int;
  v_refused int;
  v_pending int;
begin
  if v_email is null then
    return 0;
  end if;
  if exists (
    select 1 from notifications
    where lower(owner_email) = v_email and kind = 'daily' and created_at::date = current_date
  ) then
    return 0;
  end if;

  select
    count(*),
    count(*) filter (where ou.status = 'refused'),
    count(*) filter (where ou.status is null or ou.status = 'pending')
  into v_orders, v_refused, v_pending
  from orders o
  join stores s on s.id = o.store_id
  left join outcomes ou on ou.order_id = o.id
  where lower(coalesce(s.owner_email, '')) = v_email
    and o.ordered_at::date = current_date;

  if coalesce(v_orders, 0) = 0 then
    return 0;
  end if;

  insert into notifications (owner_email, kind, title, body, link)
  values (
    v_email,
    'daily',
    'Daily report',
    format('%s order%s today · %s refused · %s awaiting a verdict',
           v_orders, case when v_orders = 1 then '' else 's' end, v_refused, v_pending),
    '/orders'
  );
  return 1;
end;
$$;

revoke all on function verafo_daily_digest() from public, anon;
grant execute on function verafo_daily_digest() to authenticated;

-- ── Outcome recorded ────────────────────────────────────────
-- EVERY logged outcome notifies the store owner, including the ones they log
-- themselves. That was a deliberate reversal: skipping self-logged outcomes is
-- quieter, but the bell is the record of what happened to the order book, and a
-- merchant who marks five orders in the Outcomes page should be able to see
-- five entries here. The bell is capped at the 25 most recent, so this cannot
-- grow into a wall.
--
-- Not muted for bulk actions either. Rejecting 40 orders together writes 40
-- notifications, which is the truthful count of what just happened.
create or replace function on_outcome_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_product text;
  v_owner text;
  v_actor text := verafo_current_email();
  v_title text;
  v_body text;
begin
  -- A cleared verdict is not news, and neither is an UPDATE that left the
  -- status where it was (writeOutcome() upserts on every save).
  if new.status is null or new.status = 'pending' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  select o.buyer_phone, o.product_name, lower(coalesce(s.owner_email, ''))
    into v_phone, v_product, v_owner
  from orders o
  join stores s on s.id = o.store_id
  where o.id = new.order_id;

  -- An order whose store was deleted outranks having nobody to tell.
  if coalesce(v_owner, '') = '' then
    return null;
  end if;

  v_title := case new.status
    when 'accepted' then 'Order accepted'
    when 'refused' then 'Order refused'
    else format('Order marked %s', new.status)
  end;

  v_body := concat_ws(' · ', nullif(v_phone, ''), nullif(v_product, ''));

  -- Say who did it when that is not the owner. Without this, an admin fixing a
  -- verdict on a merchant's behalf looks like the merchant did it.
  if coalesce(v_actor, '') <> '' and v_actor <> v_owner then
    v_body := concat_ws(' · ', v_body, format('by %s', v_actor));
  end if;

  insert into notifications (owner_email, kind, title, body, link)
  values (v_owner, 'outcome', v_title, v_body, '/orders/pending');
  return null;
end;
$$;

drop trigger if exists trg_outcome_notify on outcomes;
create trigger trg_outcome_notify
  after insert or update of status on outcomes
  for each row execute function on_outcome_notify();

-- Make the new table, functions and trigger visible to PostgREST at once, so the
-- bell cannot report "not switched on" against a database that already is.
notify pgrst, 'reload schema';
