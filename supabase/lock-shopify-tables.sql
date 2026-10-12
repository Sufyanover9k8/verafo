-- ============================================================
-- Verafo — lock the Shopify app's own tables
--
-- Applied BY HAND in production on 2026-10-10 (this file is the written
-- record of that change, and is safe to re-run anywhere).
--
-- WHY
-- The Shopify app keeps its Prisma tables in the same database as Verafo, in
-- the `public` schema, where Supabase grants anon and authenticated access by
-- default. They hold OAuth session data and Shopify access tokens
-- ("Session"), the app's connection state ("ShopSetup") and Prisma's own
-- migration history ("_prisma_migrations"), so the public key could read
-- them. Nothing in the browser or the edge function touches these tables:
-- only the Shopify app's server-side Prisma connection does.
--
-- WHAT IT DOES
--   · revokes every privilege from public, anon and authenticated, and
--   · enables row level security (there are no policies, so those roles see
--     nothing at all).
-- It deliberately does NOT use FORCE ROW LEVEL SECURITY: the Prisma
-- connection is the table owner, and the owner stays exempt from RLS, so the
-- Shopify app keeps working. The service role bypasses RLS as always.
--
-- Idempotent: tables that are not present are skipped with a notice.
-- Rollback is at the bottom.
-- ============================================================

begin;

do $$
declare
  v_tables text[] := array['Session', 'ShopSetup', '_prisma_migrations'];
  v_name text;
  v_reg regclass;
begin
  foreach v_name in array v_tables loop
    v_reg := to_regclass(format('public.%I', v_name));
    if v_reg is null then
      raise notice 'lock-shopify-tables: % is not present in this database, skipping.', v_name;
      continue;
    end if;

    execute format('alter table %s enable row level security', v_reg);
    execute format('revoke all on table %s from public, anon, authenticated', v_reg);
    raise notice 'lock-shopify-tables: % locked (RLS on, anon/authenticated revoked).', v_name;
  end loop;
end $$;

-- Self-check: none of the three may be reachable by anon or authenticated.
-- (Assumes the Supabase roles anon/authenticated exist, which they do on any
-- hosted Supabase project.)
do $$
declare
  v_tables text[] := array['Session', 'ShopSetup', '_prisma_migrations'];
  v_roles text[] := array['anon', 'authenticated'];
  v_privs text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
  v_name text;
  v_role text;
  v_priv text;
  v_reg regclass;
begin
  foreach v_name in array v_tables loop
    v_reg := to_regclass(format('public.%I', v_name));
    if v_reg is null then
      continue;
    end if;

    if not (select relrowsecurity from pg_class where oid = v_reg) then
      raise exception 'lock-shopify-tables failed: row level security is still off on %.', v_name;
    end if;

    foreach v_role in array v_roles loop
      foreach v_priv in array v_privs loop
        if has_table_privilege(v_role, v_reg, v_priv) then
          raise exception 'lock-shopify-tables failed: % still has % on %.', v_role, v_priv, v_name;
        end if;
      end loop;
    end loop;
  end loop;
end $$;

commit;

-- ============================================================
-- ROLLBACK — puts the defaults back. Only for recovery: this re-opens the
-- Shopify app's OAuth sessions to the public key.
-- ============================================================
-- begin;
-- grant all on table public."Session", public."ShopSetup", public."_prisma_migrations" to anon, authenticated;
-- alter table public."Session" disable row level security;
-- alter table public."ShopSetup" disable row level security;
-- alter table public."_prisma_migrations" disable row level security;
-- commit;
