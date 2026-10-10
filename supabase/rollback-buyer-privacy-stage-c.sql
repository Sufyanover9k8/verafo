-- ============================================================
-- ROLLBACK — PRIVACY STAGE C (buyer-privacy-stage-c.sql)
--
-- WHEN TO USE
--   ⚠️⚠️⚠️  EMERGENCY RECOVERY ONLY. This re-opens the exact exposure the
--   privacy release closed: any signed-in user can read every buyer row
--   (embedding included), the admin list, everybody's chats and the public
--   key can reach the functions Stage C revoked. Use it only if Stage C
--   breaks production and you must restore service now, then fix forward and
--   re-apply Stage C.
--
-- WHAT IT RESTORES
--   buyers: "buyers read" (true) + "buyers insert stub", and the
--           select/insert/update/delete grants for authenticated.
--   chats / chat_messages: "chats all" + "chat_messages all" (true).
--   verafo_admins: "admins readable" (true).
--   functions: the anon/authenticated EXECUTE grants Stage C removed.
--   verafo_config: no row protection, readable by anon (as it was).
--   It does NOT drop chats.created_by (that would throw away ownership data).
-- ============================================================

begin;

-- ── buyers ──────────────────────────────────────────────────
drop policy if exists "buyers read own" on buyers;
drop policy if exists "buyers insert neutral stub" on buyers;
drop policy if exists "buyers read" on buyers;
drop policy if exists "buyers insert stub" on buyers;

create policy "buyers read" on buyers for select to authenticated using (true);
create policy "buyers insert stub" on buyers for insert to authenticated
  with check (
    coalesce(risk_score, 0.5) = 0.5
    and coalesce(total_orders, 0) = 0
    and coalesce(total_accepted, 0) = 0
    and coalesce(total_refused, 0) = 0
  );
grant select, insert, update, delete on buyers to authenticated;

-- ── chats / chat_messages ───────────────────────────────────
drop policy if exists "user owns their chats" on chats;
drop policy if exists "chat_messages own" on chat_messages;
drop policy if exists "chats all" on chats;
drop policy if exists "chat_messages all" on chat_messages;

create policy "chats all" on chats for all to authenticated using (true) with check (true);
create policy "chat_messages all" on chat_messages for all to authenticated using (true) with check (true);
grant select, insert, update, delete on chats to authenticated;
grant select, insert, update, delete on chat_messages to authenticated;

-- The ownership default can stay (it hurts nothing), but the column is kept:
--   alter table chats alter column created_by drop default;

-- ── verafo_admins ───────────────────────────────────────────
drop policy if exists "admins read own row" on verafo_admins;
drop policy if exists "admins readable" on verafo_admins;
create policy "admins readable" on verafo_admins for select to authenticated using (true);
grant select on verafo_admins to authenticated;

-- ── functions Stage C made private ──────────────────────────
do $$
declare
  v_sigs text[] := array[
    'network_kpis()',
    'search_stores(text, int)',
    'store_overview()',
    'daily_sales(uuid, int)',
    'verafo_is_admin()',
    'verafo_my_store_ids()',
    'verafo_current_email()'
  ];
  v_sig text;
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure('public.' || v_sig) is null then
      continue;
    end if;
    execute format('grant execute on function public.%s to anon, authenticated, service_role', v_sig);
  end loop;

  if to_regprocedure('public.upsert_store_for_shop(text)') is not null then
    execute 'grant execute on function public.upsert_store_for_shop(text) to anon, service_role';
  end if;

  -- The legacy reader comes back, every overload of it.
  declare
    r record;
  begin
    for r in
      select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'find_similar_buyers'
    loop
      execute format('grant execute on function %I.%I(%s) to anon, authenticated', r.nspname, r.proname, r.args);
    end loop;
  end;
end $$;

-- ── verafo_config: back to no protection (as it was) ────────
do $$
begin
  if to_regclass('public.verafo_config') is null then
    raise notice 'rollback: verafo_config does not exist here, skipping.';
  else
    execute 'alter table public.verafo_config disable row level security';
    execute 'grant select, insert, update, delete on table public.verafo_config to anon, authenticated';
    raise warning 'rollback: verafo_config is readable by the public key again.';
  end if;
end $$;

commit;

-- AFTER THIS: re-apply buyer-privacy-stage-c.sql as soon as the incident is
-- handled. Leaving this state in place means every buyer row (embedding and
-- feature_vector included), the admin list and every chat is readable by any
-- signed-in user, and the buyer functions are public again.
