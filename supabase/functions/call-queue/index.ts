// POST /functions/v1/call-queue
//
// The call queue lives here rather than in Uplift: a campaign can only append
// contacts, and there is no way to pull one back out, so cancelling a call means
// closing that call's own campaign. That makes Uplift a one-shot dialler and
// this function the scheduler in front of it.
//
// Called two ways:
//   • by the merchant (user JWT):  enqueue / cancel / settings / status
//   • by pg_cron every minute (body.secret): tick
//
// tick() does four things per store: pull newly risky orders into the queue, start
// the next waiting call while the budget allows, settle anything that finished, and
// accept the safe orders nobody needs to call. The last two and the dialling itself
// are each gated by their own switch on the workflow board (workflow_automation).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`missing secret ${k}`);
  return v;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** PKR per second of talk time: Uplift charges a flat 12 PKR/minute. */
const PKR_PER_SECOND = 12 / 60;
/** Refuse to start a call with less than a minute of budget left. */
const MIN_CALL_PKR = 12;
const LIVE_VERIFY = ['queued', 'dialing', 'in_call'];

/** An order is retried automatically at most this often after a finished call. */
const RETRY_AFTER_DAYS = 7;

const monthStart = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

function admin() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
}

async function usedPkr(db: ReturnType<typeof admin>, storeId: string) {
  const { data } = await db.from('call_usage').select('pkr').eq('store_id', storeId).gte('period', monthStart());
  return (data ?? []).reduce((sum, row) => sum + Number(row.pkr ?? 0), 0);
}

/** Dispatch one queued call through auto-verify (which owns the Uplift call). */
async function dispatch(db: ReturnType<typeof admin>, queueRow: Record<string, unknown>) {
  // Claim the row first: a manual tick and the cron tick can overlap, and only
  // one of them may start the call (the loser must not cancel the winner's
  // verification by dispatching a second time).
  const { data: claimed } = await db
    .from('call_queue')
    .update({ status: 'dialing', note: 'dispatching' })
    .eq('id', queueRow.id)
    .eq('status', 'waiting')
    .select('id');
  if (!claimed?.length) return { ok: false, status: 0, error: 'already claimed' };

  const res = await fetch(`${env('SUPABASE_URL')}/functions/v1/auto-verify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ order_id: queueRow.order_id, queue_id: queueRow.id }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    await db
      .from('call_queue')
      .update({ status: 'failed', note: String(body.error ?? `dispatch failed (${res.status})`).slice(0, 300) })
      .eq('id', queueRow.id)
      .in('status', ['waiting', 'dialing']);
    return { ok: false, status: res.status, error: body.error };
  }
  return { ok: true, verification: body.verification };
}

/** Pull pending_review orders at or above the store's threshold into the queue. */
async function topUp(db: ReturnType<typeof admin>, storeId: string, threshold: number) {
  const { data: candidates } = await db
    .from('app_order_cards')
    .select('order_id, risk_score, verify_status')
    .eq('store_id', storeId)
    .eq('status', 'pending_review')
    .gte('risk_score', threshold)
    .order('risk_score', { ascending: false })
    .limit(50);

  const rows = (candidates ?? []).filter(
    (c) => !c.verify_status || !LIVE_VERIFY.includes(c.verify_status as string),
  );
  if (!rows.length) return 0;

  const ids = rows.map((r) => r.order_id);
  const { data: existing } = await db
    .from('call_queue')
    .select('order_id')
    .in('order_id', ids)
    .in('status', ['waiting', 'dialing']);
  const queued = new Set((existing ?? []).map((e) => e.order_id));

  // Without this an order that was just called (and did not pick up) would be
  // re-queued on the very next tick, forever. One automatic attempt per order
  // per RETRY_AFTER_DAYS, whether that attempt finished, failed or was
  // cancelled by the merchant — they can always tap Auto Verify by hand.
  const since = new Date(Date.now() - RETRY_AFTER_DAYS * 86_400_000).toISOString();
  const { data: attempted } = await db
    .from('call_queue')
    .select('order_id')
    .in('order_id', ids)
    .gte('created_at', since);
  const tried = new Set((attempted ?? []).map((a) => a.order_id));

  const inserts = rows
    .filter((r) => !queued.has(r.order_id) && !tried.has(r.order_id))
    .map((r) => ({
      store_id: storeId,
      order_id: r.order_id,
      status: 'waiting',
      auto: true,
      note: `auto: risk ${Number(r.risk_score).toFixed(2)} ≥ ${threshold.toFixed(2)}`,
    }));
  if (!inserts.length) return 0;

  // The partial unique index makes a double insert harmless.
  const { error } = await db.from('call_queue').insert(inserts);
  if (error) return 0;
  return inserts.length;
}

/**
 * Nudge the live call's verification forward. The app polls while it is open,
 * but a store that queued calls and closed the app would otherwise sit forever
 * on one 'dialing' row, because nobody would ever ask Uplift how the call went.
 */
async function advance(db: ReturnType<typeof admin>, storeId: string) {
  const { data: live } = await db
    .from('call_queue')
    .select('id, verification_id')
    .eq('store_id', storeId)
    .eq('status', 'dialing');
  for (const row of live ?? []) {
    if (!row.verification_id) continue;
    await fetch(`${env('SUPABASE_URL')}/functions/v1/verify-status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ verification_id: row.verification_id }),
    }).catch(() => undefined);
  }
}

/** Close the queue entry once its verification reached a terminal state. */
async function settle(db: ReturnType<typeof admin>, storeId: string) {
  const { data: live } = await db
    .from('call_queue')
    .select('id, verification_id')
    .eq('store_id', storeId)
    .eq('status', 'dialing');
  if (!live?.length) return 0;

  const ids = live.map((l) => l.verification_id).filter(Boolean);
  if (!ids.length) return 0;

  const { data: verifications } = await db.from('call_verifications').select('id, status').in('id', ids);
  const finished = (verifications ?? []).filter((v) => !LIVE_VERIFY.includes(v.status as string));
  for (const v of finished) {
    await db
      .from('call_queue')
      .update({ status: v.status === 'canceled' ? 'canceled' : 'done' })
      .eq('verification_id', v.id)
      .eq('status', 'dialing');
  }
  return finished.length;
}

/** What a finished call means for the order. Anything else (no answer) stays put. */
const OUTCOME_DECISION: Record<string, 'approved' | 'rejected'> = {
  confirmed: 'approved',
  cancelled: 'rejected',
  wrong_person: 'rejected',
};

async function decide(db: ReturnType<typeof admin>, orderIds: string[], status: 'approved' | 'rejected') {
  if (!orderIds.length) return 0;
  const { data } = await db
    .from('order_fulfillment')
    .update({ status, decided_by: 'automate', decided_at: new Date().toISOString() })
    .in('order_id', orderIds)
    .eq('status', 'pending_review')
    .select('order_id');
  return data?.length ?? 0;
}

/**
 * Turn the finished calls into order decisions and apply any corrections the
 * caller agreed to. Runs whatever the wires say: it only reflects calls that
 * already happened, and it never overrides a decision the merchant made.
 */
async function settleCalls(
  db: ReturnType<typeof admin>,
  storeId: string,
  applyMode: string,
): Promise<{ decided: number; applied: number }> {
  const report = { decided: 0, applied: 0 };

  // 1. orders a call already reached a verdict on
  const { data: finished } = await db
    .from('call_verifications')
    .select('id, order_id, outcome, corrections, applied, status')
    .eq('store_id', storeId)
    .eq('status', 'completed')
    .not('outcome', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60);

  for (const verification of finished ?? []) {
    const decision = OUTCOME_DECISION[String(verification.outcome)];
    if (!decision) continue;

    // 2. write the caller's corrections through the one endpoint that also knows
    //    how to reach Shopify, but only when the merchant asked us to.
    const corrections = (verification.corrections ?? []) as { field: string; to: string }[];
    if (applyMode !== 'off' && corrections.length && !verification.applied) {
      const patch: Record<string, string> = {};
      for (const correction of corrections) {
        if (correction.field === 'name') patch.customer_name = correction.to;
        else if (correction.field === 'phone') patch.buyer_phone = correction.to;
        else if (correction.field === 'address') patch.address = correction.to;
        else if (correction.field === 'city') patch.city = correction.to;
        else if (correction.field === 'item') patch.product_name = correction.to;
      }
      if (Object.keys(patch).length) {
        const res = await fetch(`${env('SUPABASE_URL')}/functions/v1/apply-edit`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order_id: verification.order_id,
            patch,
            target: applyMode === 'shopify' ? 'shopify' : 'local',
            verification_id: verification.id,
          }),
        }).catch(() => null);
        if (res?.ok) report.applied += 1;
      }
    }

    report.decided += await decide(db, [verification.order_id], decision);
  }

  return report;
}

/**
 * Accept the orders that never needed a call: the quiet ones, well below the
 * store's risk line. This is the "Safe orders ship without a call" wire on the
 * workflow board, so it runs on its own and does not require calling to be on.
 */
async function autoAccept(db: ReturnType<typeof admin>, storeId: string, threshold: number): Promise<number> {
  const { data: quiet } = await db
    .from('app_order_cards')
    .select('order_id')
    .eq('store_id', storeId)
    .eq('status', 'pending_review')
    .lt('risk_score', threshold)
    .limit(100);
  const quietIds = (quiet ?? []).map((row) => row.order_id);
  if (!quietIds.length) return 0;
  return decide(db, quietIds, 'approved');
}

/** The workflow switches for one store, as an edge → on map. */
async function wiresFor(db: ReturnType<typeof admin>): Promise<Map<string, Record<string, boolean>>> {
  const { data } = await db.from('workflow_automation').select('store_id, edge, enabled');
  const map = new Map<string, Record<string, boolean>>();
  for (const row of data ?? []) {
    const storeId = String(row.store_id);
    const current = map.get(storeId) ?? {};
    current[String(row.edge)] = Boolean(row.enabled);
    map.set(storeId, current);
  }
  return map;
}

async function tick(db: ReturnType<typeof admin>) {
  const { data: stores } = await db
    .from('store_call_settings')
    .select('store_id, auto_call, risk_threshold, monthly_budget_pkr, apply_mode');
  const wires = await wiresFor(db);
  const report = { stores: 0, added: 0, dispatched: 0, skipped: 0, decided: 0, applied: 0, accepted: 0, blocked: [] as string[] };

  for (const store of stores ?? []) {
    report.stores += 1;
    const storeId = store.store_id as string;
    const settings = wires.get(storeId) ?? {};
    // A store that predates the workflow board keeps the old behaviour: both
    // wires follow whatever Automate calls was set to.
    const callDial = settings.call_dial ?? Boolean(store.auto_call);
    const autoAcceptOn = settings.auto_accept ?? Boolean(store.auto_call);

    await advance(db, storeId);
    await settle(db, storeId);

    const threshold = Number(store.risk_threshold ?? 0.5);
    const settled = await settleCalls(db, storeId, String(store.apply_mode ?? 'off'));
    report.decided += settled.decided;
    report.applied += settled.applied;

    // The quick lane off the Orders board: safe orders ship without a call.
    if (autoAcceptOn) report.accepted += await autoAccept(db, storeId, threshold);

    if (!callDial) {
      report.skipped += 1;
      continue;
    }

    report.added += await topUp(db, storeId, threshold);

    // One call at a time per store: nothing new starts while a call is live.
    const { data: live } = await db
      .from('call_queue')
      .select('id, order_id')
      .eq('store_id', storeId)
      .eq('status', 'dialing')
      .limit(1);
    if (live?.length) {
      report.skipped += 1;
      continue;
    }

    const spent = await usedPkr(db, storeId);
    const budget = Number(store.monthly_budget_pkr ?? 1000);
    if (spent + MIN_CALL_PKR > budget) {
      report.skipped += 1;
      report.blocked.push(storeId);
      continue;
    }

    const { data: next } = await db
      .from('call_queue')
      .select('id, order_id')
      .eq('store_id', storeId)
      .eq('status', 'waiting')
      .order('created_at', { ascending: true })
      .limit(1);
    if (!next?.length) {
      continue;
    }

    const dispatched = await dispatch(db, next[0]);
    if (dispatched.ok) report.dispatched += 1;
    else report.skipped += 1;
  }

  return report;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? 'status');
    const db = admin();

    // ---- cron path -------------------------------------------------------
    if (body.secret) {
      // Dedicated secret for the scheduler (verafo_config.queue_secret), so the
      // pre-existing `cron_secret` stays owned by the Vercel sweep.
      const { data: cfg } = await db.from('verafo_config').select('value').eq('key', 'queue_secret').maybeSingle();
      if (!cfg?.value || String(body.secret) !== String(cfg.value)) return json({ error: 'bad secret' }, 401);
      return json({ ok: true, ticked: await tick(db) });
    }

    // ---- merchant path ---------------------------------------------------
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'not signed in' }, 401);

    const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: 'not signed in' }, 401);
    const user = userData.user;

    if (action === 'settings') {
      const { data: stores } = await userClient.from('stores').select('id, name').order('name');
      const ids = (stores ?? []).map((s) => s.id);
      const { data: settings } = await userClient.from('store_call_settings').select('*').in('store_id', ids);
      return json({ stores, settings });
    }

    if (action === 'save_settings') {
      const storeId = String(body.store_id ?? '');
      if (!storeId) return json({ error: 'store_id is required' }, 400);
      const patch: Record<string, unknown> = {};
      if (typeof body.auto_call === 'boolean') patch.auto_call = body.auto_call;
      if (body.risk_threshold !== undefined) {
        const t = Number(body.risk_threshold);
        if (!Number.isFinite(t) || t < 0 || t > 1) return json({ error: 'risk_threshold must be 0–1' }, 400);
        patch.risk_threshold = Math.round(t * 1000) / 1000;
      }
      if (body.monthly_budget_pkr !== undefined) {
        const b = Number(body.monthly_budget_pkr);
        if (!Number.isFinite(b) || b < 0) return json({ error: 'monthly_budget_pkr must be ≥ 0' }, 400);
        patch.monthly_budget_pkr = Math.round(b * 100) / 100;
      }
      if (body.apply_mode !== undefined) {
        const mode = String(body.apply_mode);
        if (!['off', 'local', 'shopify'].includes(mode)) {
          return json({ error: 'apply_mode must be off, local or shopify' }, 400);
        }
        patch.apply_mode = mode;
      }
      if (!Object.keys(patch).length) return json({ error: 'nothing to update' }, 400);

      const { data, error } = await userClient
        .from('store_call_settings')
        .update(patch)
        .eq('store_id', storeId)
        .select('*')
        .maybeSingle();
      if (error) return json({ error: error.message }, 403);
      if (!data) return json({ error: 'store not found for this account' }, 404);

      // Switching the toggle on immediately fills the queue instead of waiting
      // up to a minute for the next tick.
      let added = 0;
      const automated = { decided: 0, applied: 0, accepted: 0 };
      if (patch.auto_call === true || patch.apply_mode !== undefined) {
        const settled = await settleCalls(db, storeId, String(data.apply_mode ?? 'off'));
        automated.decided = settled.decided;
        automated.applied = settled.applied;
        if (patch.auto_call === true) added = await topUp(db, storeId, Number(data.risk_threshold ?? 0.5));
      }
      return json({ settings: data, added, automated });
    }

    if (action === 'enqueue') {
      const orderIds: string[] = Array.isArray(body.order_ids)
        ? body.order_ids.map(String)
        : body.order_id
          ? [String(body.order_id)]
          : [];
      if (!orderIds.length) return json({ error: 'order_ids is required' }, 400);

      const { data: cards } = await userClient
        .from('app_order_cards')
        .select('order_id, store_id, risk_score')
        .in('order_id', orderIds);
      if (!cards?.length) return json({ error: 'order not found for this account' }, 404);

      const rows = cards.map((c) => ({
        store_id: c.store_id,
        order_id: c.order_id,
        status: 'waiting',
        auto: false,
        note: `queued by ${user.email ?? 'merchant'}`,
      }));
      const { data: inserted, error } = await db.from('call_queue').insert(rows).select('*');
      if (error) return json({ error: error.message }, 400);
      return json({ queued: inserted });
    }

    if (action === 'cancel') {
      const queueId = String(body.queue_id ?? '');
      if (!queueId) return json({ error: 'queue_id is required' }, 400);

      // RLS-visible row first: the caller may only cancel their own store's call.
      const { data: row } = await userClient.from('call_queue').select('*').eq('id', queueId).maybeSingle();
      if (!row) return json({ error: 'queue entry not found' }, 404);
      if (row.status === 'done' || row.status === 'canceled' || row.status === 'failed') {
        return json({ error: 'this call already finished', queue: row }, 409);
      }

      // If the phone is already ringing, close the one-contact campaign. That is
      // the only way to stop a live Uplift call.
      if (row.verification_id) {
        const { data: verification } = await db
          .from('call_verifications')
          .select('id, campaign_id, status')
          .eq('id', row.verification_id)
          .maybeSingle();
        if (verification?.campaign_id) {
          await fetch(`https://api.upliftai.org/v1/campaigns/${verification.campaign_id}/close`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${env('UPLIFT_API_KEY')}`, 'Content-Type': 'application/json' },
            body: '{}',
          }).catch(() => undefined);
        }
        if (verification && LIVE_VERIFY.includes(verification.status as string)) {
          await db
            .from('call_verifications')
            .update({ status: 'canceled', error: 'canceled by merchant', ended_at: new Date().toISOString() })
            .eq('id', verification.id);
        }
        await db
          .from('call_queue')
          .update({ status: 'canceled', note: 'canceled by merchant' })
          .eq('id', queueId)
          .in('status', ['waiting', 'dialing']);
        return json({ ok: true, stopped_call: Boolean(row.verification_id) });
      }

      const { data: canceled } = await db
        .from('call_queue')
        .update({ status: 'canceled', note: 'canceled by merchant' })
        .eq('id', queueId)
        .eq('status', 'waiting')
        .select('*')
        .maybeSingle();
      return json({ ok: true, queue: canceled, stopped_call: false });
    }

    // status: everything the queue screen needs in one round trip.
    const { data: stores } = await userClient.from('stores').select('id, name').order('name');
    const storeIds = (stores ?? []).map((s) => s.id);
    const [{ data: settings }, { data: queue }, { data: usage }] = await Promise.all([
      userClient.from('store_call_settings').select('*').in('store_id', storeIds),
      userClient
        .from('call_queue')
        .select('id, store_id, order_id, status, auto, note, created_at, verification_id')
        .in('store_id', storeIds)
        .in('status', ['waiting', 'dialing'])
        .order('created_at', { ascending: true }),
      userClient.from('call_usage').select('store_id, pkr, seconds, period').in('store_id', storeIds).gte('period', monthStart()),
    ]);

    const orders = queue?.length
      ? (
          await userClient
            .from('app_order_cards')
            .select('order_id, customer_name, buyer_phone, address, city, product_name, price, risk_score, order_reference, store_name')
            .in('order_id', queue.map((q) => q.order_id))
        ).data
      : [];

    const byOrder = new Map((orders ?? []).map((o) => [o.order_id, o]));
    const rows = (queue ?? []).map((q, index) => ({ ...q, position: index + 1, card: byOrder.get(q.order_id) ?? null }));

    return json({
      stores,
      settings,
      queue: rows,
      usage: (usage ?? []).reduce(
        (acc: Record<string, { pkr: number; seconds: number }>, row) => {
          const cur = acc[row.store_id] ?? { pkr: 0, seconds: 0 };
          acc[row.store_id] = { pkr: cur.pkr + Number(row.pkr ?? 0), seconds: cur.seconds + Number(row.seconds ?? 0) };
          return acc;
        },
        {},
      ),
      rate_pkr_per_second: PKR_PER_SECOND,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
