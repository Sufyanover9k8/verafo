-- ============================================================
-- ROLLBACK — PRIVACY STAGE A (buyer-privacy-stage-a.sql)
--
-- WHEN TO USE
--   · Before Stage C: to undo Stage A if the frontend was never deployed, or
--     if the practice project needs a clean slate.
--   · After Stage C: ONLY for recovery. Dropping these functions removes the
--     safe read path that Buyer Lookup and the New Order preview call, so the
--     UI's lookup stops working until Stage A is applied again.
--   · It does NOT touch any policy, so it can never re-open buyers by itself.
--     (After Stage C, buyers stays closed: only the lookup features break.)
--
-- WHAT IT UNDOES
--   verafo_phone_key(text), verafo_normalize_phone(text),
--   verafo_lookup_caller_email(), buyer_network_lookup(text),
--   similar_buyers_by_phone(text, int) — and their grants.
--   Stage A only ever created/replaced these functions.
-- ============================================================

begin;

drop function if exists buyer_network_lookup(text);
drop function if exists similar_buyers_by_phone(text, int);
drop function if exists verafo_lookup_caller_email();
drop function if exists verafo_normalize_phone(text);
drop function if exists verafo_phone_key(text);

commit;

-- After this, re-applying buyer-privacy-stage-a.sql restores everything.
-- Note: any lookup rows the functions logged in `lookups` stay behind — they
-- are that user's own "recent lookups" history, scoped by owner_email. Delete
-- them with:
--   delete from lookups where owner_email = '<that user''s email>';
