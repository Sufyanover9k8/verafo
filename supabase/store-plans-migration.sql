-- ============================================================
-- Verafo x Shopify — the shop's active App Pricing plan
-- Run in the Supabase SQL Editor, AFTER supabase/shopify-migration.sql
-- (this table references stores.id).
--
-- READ-ONLY for merchants. There is deliberately NO insert / update /
-- delete rule for signed-in users, so a plan cannot be forged from the
-- dashboard. Only the service-role key (the Shopify app's webhook)
-- writes here, and the service role is not subject to RLS at all.
--
-- A missing row means "plan unknown" — the dashboard hides the badge.
-- Never default a missing row to "Free".
-- ============================================================

create table if not exists store_plans (
  store_id           uuid primary key references stores(id) on delete cascade,
  -- The plan name exactly as the Shopify Partner Dashboard reports it,
  -- for example "Free" / "Standard" / "Founder One". Stored verbatim and
  -- never renamed, normalised or guessed.
  plan_name          text not null,
  status             text,          -- ACTIVE / PENDING / CANCELLED / EXPIRED
  subscription_id    text,          -- gid://shopify/AppSubscription/…
  current_period_end timestamptz,
  updated_at         timestamptz not null default now()
);

alter table store_plans enable row level security;

-- Read rule: a signed-in user may read a plan row only when the store it
-- belongs to is theirs. The email comparison mirrors verafo_current_email()
-- from supabase/rls-production.sql — lower(auth.jwt() ->> 'email') — but is
-- written inline here so this file has no dependency on that file or on any
-- of its helper functions.
drop policy if exists "store_plans read own" on store_plans;
create policy "store_plans read own" on store_plans for select to authenticated
  using (
    exists (
      select 1
      from stores s
      where s.id = store_plans.store_id
        and lower(coalesce(s.owner_email, '')) =
            lower(coalesce(auth.jwt() ->> 'email', ''))
        and coalesce(auth.jwt() ->> 'email', '') <> ''
    )
  );

-- Read-only for signed-in users, and nothing at all for the public anon key.
-- There is no insert/update/delete policy above, and the grants are revoked
-- below, so no signed-in user can insert, update or delete a plan row.
-- Only the service-role key (the Shopify app's webhook) writes here.
grant select on store_plans to authenticated;
revoke insert, update, delete on store_plans from authenticated, anon;
