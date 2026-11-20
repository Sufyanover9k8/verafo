// POST /functions/v1/auto-verify   { order_id }
//
// Queues one Uplift AI campaign call for a single order and returns the
// verification row. Phase 2 of the pipeline: instead of a human phoning the
// buyer, Uplift's "Sohail" agent calls them, confirms name / phone / address /
// item, and notes any correction. Nothing is written back to the order here —
// the merchant still taps once (see verify-status + the app's diff sheet).
import { createClient } from 'npm:@supabase/supabase-js@2';

const UPLIFT = 'https://api.upliftai.org/v1';
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

/** One CSV field: quoted, quotes doubled, trimmed to Uplift's 160-char value cap. */
function csvCell(v: unknown): string {
  const s = (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim().slice(0, 160);
  return `"${s.replace(/"/g, '""')}"`;
}

async function uplift(path: string, init: RequestInit = {}) {
  const res = await fetch(`${UPLIFT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('UPLIFT_API_KEY')}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`uplift ${path} → ${res.status}: ${msg.slice(0, 400)}`);
  }
  return body as Record<string, unknown>;
}

const RISK_WORD = (n: number | null) => (n === null ? 'unknown' : n >= 0.7 ? 'high' : n >= 0.35 ? 'medium' : 'low');

/** A short, human-readable history line for the agent's record block. */
function historyLine(c: Record<string, unknown>) {
  const bits: string[] = [];
  const orders = Number(c.buyer_total_orders ?? 0);
  if (orders) {
    bits.push(`${orders} orders`);
    bits.push(`${Number(c.buyer_total_accepted ?? 0)} accepted`);
    bits.push(`${Number(c.buyer_total_refused ?? 0)} refused`);
  } else {
    bits.push('first order');
  }
  bits.push(`${RISK_WORD(c.risk_score as number | null)} risk`);
  if (c.call_outcome) bits.push(`last call: ${c.call_outcome}`);
  if (c.buyer_first_seen) bits.push(`known since ${String(c.buyer_first_seen).slice(0, 10)}`);
  return bits.join(', ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'not signed in' }, 401);

    // The queue worker (pg_cron → call-queue) calls this function with the
    // service-role key instead of a user JWT, so there is no user to resolve.
    // That path is trusted and reads the order with the admin client.
    const isService = auth.slice(7).trim() === env('SUPABASE_SERVICE_ROLE_KEY');

    // RLS does the store check: the caller only sees orders they own.
    const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });

    let user: { id: string; email?: string | null } | null = null;
    if (!isService) {
      const { data: userData } = await userClient.auth.getUser();
      const signedIn = userData?.user;
      if (!signedIn) return json({ error: 'not signed in' }, 401);
      user = { id: signedIn.id, email: signedIn.email ?? null };
    }

    const body = await req.json().catch(() => ({}));
    const orderId = String(body.order_id ?? '');
    if (!orderId) return json({ error: 'order_id is required' }, 400);

    const reader = isService
      ? createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
          auth: { persistSession: false },
        })
      : userClient;

    const { data: card, error: cardError } = await reader
      .from('app_order_cards')
      .select('*')
      .eq('order_id', orderId)
      .maybeSingle();
    if (cardError) throw cardError;
    if (!card) return json({ error: 'order not found for this account' }, 404);

    if (card.verify_status === 'queued' || card.verify_status === 'dialing' || card.verify_status === 'in_call') {
      return json({ error: 'a verification call is already running for this order', verify_id: card.verify_id }, 409);
    }
    if (!card.buyer_phone) return json({ error: 'this order has no phone number to call' }, 422);

    const queueId = body.queue_id ? String(body.queue_id) : '';

    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });

    // Credits gate: the plan pays for a number of call minutes (one credit is
    // one minute, rounded up) and only its overage cap lets a store go past
    // that. With no credit left, no call may start.
    const { data: creditRows } = await admin.rpc('store_credit_status', {
      p_store: card.store_id,
    });
    const creditRow = Array.isArray(creditRows) ? creditRows[0] : creditRows;
    if (Number(creditRow?.remaining_credits ?? 0) < 1 && !creditRow?.allow_overage) {
      return json(
        {
          error:
        'the plan has no credits left - upgrade the plan or add credits in the Shopify admin',
          plan: creditRow?.plan_name ?? 'Free',
          used_credits: Number(creditRow?.used_credits ?? 0),
          remaining_credits: 0,
        },
        402,
      );
    }

    // One live row per order is enforced by a unique partial index; clear any
    // stale non-terminal row first so a retry is never blocked forever.
    await admin
      .from('call_verifications')
      .update({ status: 'canceled', ended_at: new Date().toISOString() })
      .eq('order_id', orderId)
      .in('status', ['queued', 'dialing', 'in_call']);

    const { data: verification, error: insertError } = await admin
      .from('call_verifications')
      .insert({
        order_id: orderId,
        store_id: card.store_id,
        status: 'queued',
        assistant_id: env('UPLIFT_ASSISTANT_ID'),
        requested_by: user ? user.id : null,
        requested_by_email: user ? (user.email ?? null) : 'auto-call queue',
        payload: { card: { ...card, verify_corrections: undefined } },
      })
      .select('*')
      .single();
    if (insertError) throw insertError;

    // The queue entry (when this call came from the queue) follows the call:
    // dialing while it runs, then failed if Uplift refuses to place it.
    const settleQueue = async (status: 'failed' | 'waiting', note: string) => {
      if (!queueId) return;
      await admin.from('call_queue').update({ status, note }).eq('id', queueId).eq('status', 'waiting');
    };
    if (queueId) {
      await admin
        .from('call_queue')
        .update({ status: 'dialing', verification_id: verification.id })
        .eq('id', queueId)
        .eq('status', 'waiting');
    }

    const stamp = Date.now().toString(36).toUpperCase();
    const attributes: Record<string, string> = {
      name: card.customer_name || 'Customer',
      phone: card.buyer_phone,
      store: card.store_name || 'the store',
      address: [card.address, card.city].filter(Boolean).join(', '),
      item: [card.product_name, card.quantity > 1 ? `x${card.quantity}` : ''].filter(Boolean).join(' '),
      price: card.price === null || card.price === undefined ? '' : `PKR ${Number(card.price).toLocaleString('en-PK')}`,
      reference: card.order_reference || '',
      history: historyLine(card as Record<string, unknown>),
    };

    const columns = Object.keys(attributes);
    const csv = [columns.map((c) => `"${c}"`).join(','), columns.map((c) => csvCell(attributes[c])).join(',')].join('\n');

    try {
      const list = await uplift('/contact-lists', {
        method: 'POST',
        body: JSON.stringify({
          name: `Verafo ${card.order_reference || orderId} ${stamp}`,
          kind: 'csv_upload',
          data: csv,
        }),
      });

      const listId = (list.listId ?? (list.data as Record<string, unknown>)?.listId) as string | undefined;
      if (!listId) throw new Error(`no listId in contact-list response: ${JSON.stringify(list).slice(0, 300)}`);

      const campaign = await uplift('/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: `Verafo verify ${card.order_reference || orderId} ${stamp}`,
          mode: 'bounded',
          config: {
            goal: 'order_confirmation',
            assistant: { assistantId: env('UPLIFT_ASSISTANT_ID') },
            assistantVersion: 'prod',
            contacts: { listId },
            schedule: {
              // "Call now": a merchant tapping Auto Verify expects the phone to
              // ring immediately, so the window is the whole day. If a quieter
              // window is ever needed it belongs in store settings, not here.
              callingWindow: { from: '00:00', to: '23:59', tz: 'Asia/Karachi' },
            },
            dialing: {
              lines: 1,
              retryPolicy: { maxAttempts: 2, retryOn: ['no_answer', 'busy'], backoffMinutes: [5] },
            },
          },
        }),
      });

      const campaignId = (campaign.campaignId ?? (campaign.data as Record<string, unknown>)?.campaignId ?? campaign.id) as
        | string
        | undefined;
      if (!campaignId) throw new Error(`no campaignId in campaign response: ${JSON.stringify(campaign).slice(0, 300)}`);

      const launched = await uplift(`/campaigns/${campaignId}/launch`, { method: 'POST', body: '{}' });
      const runId = (launched.runId ?? (launched.data as Record<string, unknown>)?.runId) as string | undefined;
      const enrolled = Number(launched.enrolled ?? (launched.data as Record<string, unknown>)?.enrolled ?? NaN);

      const { data: updated, error: updateError } = await admin
        .from('call_verifications')
        .update({
          contact_list_id: listId,
          campaign_id: campaignId,
          campaign_run_id: runId ?? null,
          started_at: new Date().toISOString(),
          payload: { card, attributes, listId, campaignId, runId, enrolled },
        })
        .eq('id', verification.id)
        .select('*')
        .single();
      if (updateError) throw updateError;

      if (Number.isFinite(enrolled) && enrolled === 0) {
        await admin
          .from('call_verifications')
          .update({
            status: 'failed',
            error: 'Uplift queued no calls for this number (it may be on the do-not-call list, recently called, or invalid).',
            ended_at: new Date().toISOString(),
          })
          .eq('id', verification.id);
        await settleQueue('failed', 'Uplift excluded this number');
        return json({ error: 'Uplift excluded this number from calling', excluded: launched }, 422);
      }

      return json({ verification: updated, enrolled: Number.isFinite(enrolled) ? enrolled : null });
    } catch (upliftError) {
      const message = upliftError instanceof Error ? upliftError.message : String(upliftError);
      await admin
        .from('call_verifications')
        .update({ status: 'failed', error: message, ended_at: new Date().toISOString() })
        .eq('id', verification.id);
      await settleQueue('failed', message.slice(0, 300));
      return json({ error: message }, 502);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
