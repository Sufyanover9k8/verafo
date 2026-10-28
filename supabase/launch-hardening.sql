-- ============================================================
-- launch-hardening.sql — apply by hand in the Supabase SQL editor
-- before launch day. Nothing here is auto-applied by a deploy.
--
-- Every statement is additive and safe to run on a live database:
-- no table is rewritten in a way that locks reads, no data changes.
-- ============================================================

-- 1. THE HOT READ (Dashboard + Orders)
--
-- Both screens run exactly the same shape:
--
--   select *, stores(name), outcomes(status, resolved_at)
--     from orders
--    where store_id = $1 and deleted_at is null
--    order by ordered_at desc
--    limit 500;
--
-- Today there is a single-column index on (store_id) and one on
-- (ordered_at desc), so Postgres filters by store and then sorts the whole
-- store — fine at 2 000 orders, a visible wait at 50 000. This composite
-- partial index serves the filter, the sort and the hidden-orders predicate
-- from one structure, and only indexes rows that are ever shown.
create index if not exists orders_store_visible_ordered_idx
  on orders (store_id, ordered_at desc)
  where deleted_at is null;

-- 2. THE BUYER LOOKUP PATH
--
-- Buyer Lookup and the Outcomes row badge both fetch a buyer by phone
-- (`from('buyers').eq('phone', …)`) and by an `in (…)` list from the
-- dashboard. `phone` is the primary key, so this is already an index scan —
-- listed here so nobody "optimises" it with a sequential scan later.
-- (No statement: documented, not changed.)

-- 3. COURIER / BULK IMPORT WRITES
--
-- A courier file writes one upsert per row against `outcomes` (unique on
-- order_id) and each write fires trg_outcome_recompute, which re-aggregates
-- that buyer's orders. The index that keeps each recompute cheap:
create index if not exists outcomes_order_id_lookup_idx
  on outcomes (order_id);   -- already implied by the unique constraint; kept for clarity

-- 4. THE QUERY THAT CANNOT BE ALLOWED TO HANG
--
-- PostgREST has no statement timeout of its own: one pathological query
-- (an unbounded filter, a bad plan after a cold cache) holds its pool slot
-- until it finishes, and the pool is small on the free/paid entry tiers.
-- A wall-clock ceiling turns "the app is down" into "that one request failed".
alter role authenticated set statement_timeout = '10s';
alter role anon set statement_timeout = '10s';

-- 5. FRESH PLANS AFTER THE INDEXES
analyze orders;
analyze outcomes;
analyze buyers;

-- ── ROLLBACK ────────────────────────────────────────────────
-- drop index if exists orders_store_visible_ordered_idx;
-- drop index if exists outcomes_order_id_lookup_idx;
-- alter role authenticated reset statement_timeout;
-- alter role anon reset statement_timeout;
