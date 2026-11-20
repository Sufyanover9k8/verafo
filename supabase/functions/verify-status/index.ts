// POST /functions/v1/verify-status   { verification_id }  (or { order_id })
//
// Polls the Uplift campaign for one verification, keeps
// `public.call_verifications` current, and turns the finished transcript into a
// short list of corrections the merchant can apply with one tap. It never
// writes to `orders` / `order_fulfillment` — apply is a separate, explicit act
// from the app (RLS on order_fulfillment already allows that).
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const UPLIFT = 'https://api.upliftai.org/v1';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const env = (k: string, optional = false) => {
  const v = Deno.env.get(k);
  if (!v && !optional) throw new Error(`missing secret ${k}`);
  return v ?? '';
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function uplift(path: string) {
  const res = await fetch(`${UPLIFT}${path}`, {
    headers: { Authorization: `Bearer ${env('UPLIFT_API_KEY')}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`uplift ${path} → ${res.status}: ${String(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 300)}`);
  return body as Record<string, unknown>;
}

/** Uplift's call state → our status. A dial outcome means the call never reached a human. */
const NOT_REACHED = new Set(['voicemail', 'busy', 'no_answer', 'unreachable', 'silent_pickup', 'failed']);

function mapStatus(state?: string, connected?: boolean, outcome?: string): string {
  const live = !state || state === 'queued' || state === 'dialing' || state === 'retry_wait';
  if (live) {
    if (connected) return 'in_call';
    return state === 'dialing' || state === 'retry_wait' ? 'dialing' : 'queued';
  }
  // Terminal contact: done | exhausted | skipped. The dial outcome is the truth here —
  // a "done" contact with outcome "failed" never reached a human.
  if (outcome && NOT_REACHED.has(outcome)) return outcome === 'failed' ? 'failed' : 'no_answer';
  if (state === 'skipped') return 'failed';
  if (state === 'exhausted') return 'no_answer';
  return connected ? 'completed' : 'no_answer';
}

/** Session detail shapes are not documented for campaigns; salvage turns defensively. */
function normaliseTranscript(detail: unknown): { role: string; text: string; at?: string }[] {
  if (!detail || typeof detail !== 'object') return [];
  const root = detail as Record<string, unknown>;
  const candidates = [root.transcript, root.turns, root.messages, root.dialogue, root.log, (root.session as Record<string, unknown>)?.transcript];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) {
      return candidate
        .map((t) => {
          const e = (t ?? {}) as Record<string, unknown>;
          const text = (e.text ?? e.content ?? e.message ?? e.transcript ?? '') as string;
          const roleRaw = (e.role ?? e.speaker ?? e.source ?? '') as string;
          const role = /agent|assistant|bot|ai/i.test(roleRaw) ? 'agent' : /user|customer|human|caller/i.test(roleRaw) ? 'customer' : roleRaw || 'unknown';
          return { role, text: String(text).trim(), at: (e.at ?? e.timestamp) as string | undefined };
        })
        .filter((t) => t.text);
    }
  }
  return [];
}

type Correction = { field: string; from: string; to: string };

/** The order field each correction lands on. `item` and `quantity` are local-only. */
const CORRECTION_FIELDS: Record<string, string> = {
  name: 'customer_name',
  phone: 'buyer_phone',
  address: 'address',
  city: 'city',
  item: 'product_name',
  quantity: 'quantity',
};

/** How a finished call decides an order that is still waiting for a human. */
const DISPOSITION: Record<string, 'approved' | 'rejected'> = {
  confirm: 'approved',
  cancel: 'rejected',
  wrong_person: 'rejected',
};

type Settle = {
  at: string;
  disposition: 'approved' | 'rejected' | null;
  corrections: string[];
  target: 'local' | 'shopify' | null;
  shopify: { ok: boolean; error: string | null } | null;
  error?: string;
};

/**
 * Turns a finished call into a decision.
 *
 * Two independent switches, both owned by the merchant:
 *   - `auto_call` (Automate) decides the order when the call settles it.
 *   - `apply_mode` says whether the fixes the customer gave are written back:
 *     off → the merchant applies them by hand, local → here, shopify → here and
 *     in Shopify.
 *
 * Corrections go through `apply-edit`, which already owns the local writes, the
 * Shopify push, the `order_edits` audit row and the `applied` bookkeeping on the
 * verification. Nothing is applied twice: a verification that carries
 * `applied.settle` is skipped on the next poll.
 */
async function settleVerification(
  admin: SupabaseClient,
  verification: Record<string, unknown>,
): Promise<Settle | null> {
  const result = (verification.result ?? null) as Record<string, unknown> | null;
  if (!result) return null;

  const storeId = String(verification.store_id ?? '');
  const orderId = String(verification.order_id ?? '');
  if (!storeId || !orderId) return null;

  const { data: settings } = await admin
    .from('store_call_settings')
    .select('auto_call, apply_mode')
    .eq('store_id', storeId)
    .maybeSingle();

  const autoCall = Boolean(settings?.auto_call);
  const applyMode = String(settings?.apply_mode ?? 'off');

  // The Workflow board owns two switches on the call wire: whether a confirmed
  // call ships the parcel and whether a cancelled one refuses it. A wire with no
  // saved row follows the Automate switch, which is what merchants had before
  // the board existed.
  const { data: wires } = await admin
    .from('workflow_automation')
    .select('edge, enabled')
    .eq('store_id', storeId)
    .in('edge', ['call_ship', 'call_refuse']);
  const wire = (edge: 'call_ship' | 'call_refuse') => {
    const row = (wires ?? []).find((entry: { edge: string }) => entry.edge === edge) as
      | { enabled?: boolean }
      | undefined;
    return row ? Boolean(row.enabled) : autoCall;
  };

  const settle: Settle = {
    at: new Date().toISOString(),
    disposition: null,
    corrections: [],
    target: applyMode === 'shopify' ? 'shopify' : applyMode === 'local' ? 'local' : null,
    shopify: null,
  };

  // ── the fixes the customer gave ────────────────────────────────────────────
  const corrections = Array.isArray(verification.corrections) ? (verification.corrections as Correction[]) : [];
  if (applyMode !== 'off' && corrections.length) {
    const patch: Record<string, unknown> = {};
    for (const c of corrections) {
      const field = CORRECTION_FIELDS[String(c.field ?? '')];
      const value = String(c.to ?? '').trim();
      if (!field || !value) continue;
      patch[field] = field === 'quantity' ? Number(value) || null : value;
      settle.corrections.push(field === 'product_name' ? 'item' : field === 'customer_name' ? 'name' : field);
    }
    if (Object.keys(patch).length) {
      try {
        const res = await fetch(`${env('SUPABASE_URL')}/functions/v1/apply-edit`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order_id: orderId,
            patch,
            target: applyMode === 'shopify' ? 'shopify' : 'local',
            verification_id: verification.id,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { shopify?: { ok?: boolean; error?: string } };
        if (!res.ok) throw new Error(`apply-edit → ${res.status}`);
        // A local-only write never touches Shopify, so "did not sync" is not news:
        // only record a Shopify result when that push actually happened.
        if (applyMode === 'shopify' && body.shopify) {
          settle.shopify = { ok: Boolean(body.shopify.ok), error: body.shopify.error ?? null };
        }
      } catch (error) {
        settle.error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  // ── the decision the call made ─────────────────────────────────────────────
  // Only when Automate is on, only for an order nobody has decided yet, and only
  // if that wire on the Workflow board is on.
  const intent = String(result.intent ?? '');
  const next = DISPOSITION[intent] ?? null;
  const allowed = next ? wire(next === 'approved' ? 'call_ship' : 'call_refuse') : false;
  if (autoCall && next && allowed) {
    const { data: current } = await admin
      .from('order_fulfillment')
      .select('status')
      .eq('order_id', orderId)
      .maybeSingle();
    const status = String(current?.status ?? 'pending_review');
    if (status === 'pending_review') {
      const now = new Date().toISOString();
      const patch = { status: next, decided_by: 'call', decided_at: now };
      const { error } = current
        ? await admin.from('order_fulfillment').update(patch).eq('order_id', orderId)
        : await admin.from('order_fulfillment').insert({ order_id: orderId, ...patch });
      if (error) settle.error = settle.error ?? error.message;
      else settle.disposition = next;
    }
  }

  return settle;
}

/** One cheap LLM pass over the transcript. Returns null when unavailable. */
async function extract(transcript: { role: string; text: string }[], card: Record<string, unknown>) {
  const key = env('OPENAI_API_KEY', true);
  if (!key || transcript.length === 0) return null;

  const dialogue = transcript.map((t) => `${t.role === 'agent' ? 'Agent' : 'Customer'}: ${t.text}`).join('\n');
  const current = {
    name: card.customer_name ?? '',
    phone: card.buyer_phone ?? '',
    address: card.address ?? '',
    city: card.city ?? '',
    item: card.product_name ?? '',
    quantity: card.quantity ?? '',
  };

  const instruction = `You read a phone call transcript between a store agent and a customer in Pakistan (Urdu/English) and report what the customer actually confirmed or corrected.

The order on file:
${JSON.stringify(current, null, 2)}

Transcript:
${dialogue}

Return JSON only:
{
  "reached_customer": true|false,
  "person_confirmed": true|false,          // did they confirm they are the named customer
  "confirmed": {"name": bool, "phone": bool, "address": bool, "item": bool},  // fields they explicitly agreed with
  "corrections": [{"field": "name"|"phone"|"address"|"city"|"item"|"quantity", "from": "<value on file>", "to": "<value the customer gave>"}],
  "intent": "confirm"|"cancel"|"callback"|"wrong_person"|"unclear",
  "summary": "one short sentence a merchant can read at a glance, in English",
  "sentiment": "happy"|"neutral"|"annoyed"
}
Rules: only report a correction when the customer clearly stated a different value; never invent a value; if nothing was confirmed, use empty arrays and "unclear".
CRITICAL — "to" must be the COMPLETE new value that can be written straight onto the order, never a fragment. When the customer corrects one part of a longer value, merge it into the value on file. Example: address on file "House 42, Street 8, Block C, DHA Phase 5" and the customer says the phase is 3 → "to": "House 42, Street 8, Block C, DHA Phase 3". Keep phone numbers in international format (+92...).
The order stores the city in its own field, so never append the city to an address correction — if only the city changed, correct the "city" field instead.`;

  for (const model of [env('OPENAI_MODEL', true) || 'gpt-4o-mini', 'gpt-4o-mini']) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You extract verified facts from call transcripts. Reply with JSON only.' },
            { role: 'user', content: instruction },
          ],
        }),
      });
      if (!res.ok) continue;
      const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = payload.choices?.[0]?.message?.content;
      if (!text) continue;
      const parsed = JSON.parse(text) as {
        corrections?: Correction[];
        summary?: string;
        sentiment?: string;
        intent?: string;
        person_confirmed?: boolean;
        confirmed?: Record<string, boolean>;
      };
      return { ...parsed, corrections: Array.isArray(parsed.corrections) ? parsed.corrections.filter((c) => c && c.field && c.to) : [] };
    } catch {
      // fall through to the next model / give up quietly
    }
  }
  return null;
}

/**
 * Settles a finished verification at most once.
 *
 * Guards on `applied.settle`, so repeated polling — from the app, the website or
 * both at the same time — never applies a correction twice or flips a decision
 * back.
 */
async function maybeSettle(
  admin: SupabaseClient,
  verification: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const terminal = ['completed', 'no_answer', 'failed'].includes(String(verification.status ?? ''));
  const applied = (verification.applied ?? {}) as Record<string, unknown>;
  if (!terminal || !verification.result || applied.settle) return verification;

  const settled = await settleVerification(admin, verification);
  if (!settled) return verification;

  const { data } = await admin
    .from('call_verifications')
    .update({ applied: { ...applied, settle: settled } })
    .eq('id', String(verification.id ?? ''))
    .select('*')
    .single();
  return (data ?? verification) as Record<string, unknown>;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ error: 'not signed in' }, 401);

    const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: 'not signed in' }, 401);

    const body = await req.json().catch(() => ({}));
    const verificationId = body.verification_id ? String(body.verification_id) : '';
    const orderId = body.order_id ? String(body.order_id) : '';
    if (!verificationId && !orderId) return json({ error: 'verification_id or order_id is required' }, 400);

    // RLS: the caller only sees verifications for their own store.
    let query = userClient.from('call_verifications').select('*');
    query = verificationId ? query.eq('id', verificationId) : query.eq('order_id', orderId).order('created_at', { ascending: false }).limit(1);
    const { data: rows, error: readError } = await query;
    if (readError) throw readError;
    let verification = Array.isArray(rows) ? rows[0] : rows;
    if (!verification) return json({ error: 'verification not found' }, 404);

    const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

    // Settle from what is stored before polling: a call that already carries a
    // verdict is decided even when its campaign has gone away.
    verification = await maybeSettle(admin, verification);

    if (!verification.campaign_id) return json({ verification });

    const calls = (await uplift(`/campaigns/${verification.campaign_id}/calls?limit=25`)) as Record<string, unknown>;
    const list = (Array.isArray(calls.calls) ? calls.calls : Array.isArray((calls.data as Record<string, unknown>)?.calls) ? (calls.data as Record<string, unknown>).calls : []) as Record<string, unknown>[];
    const call = list.find((c) => (verification.contact_id && c.contactId === verification.contact_id) || c.callId === verification.call_id) ?? list[0];

    const state = call?.state as string | undefined;
    const connected = Boolean(call?.connected);
    const dialOutcome = (call?.outcome as string) ?? undefined;
    const status = mapStatus(state, connected, dialOutcome);

    // `outcome` on the campaign contact is the dial result. Once the call connected it is
    // stale (a first "no_answer" attempt stays on the row), so ignore it from then on.
    const outcome = connected ? verification.outcome ?? null : dialOutcome ?? (status === 'no_answer' ? 'no_answer' : verification.outcome) ?? null;

    const patch: Record<string, unknown> = {
      status,
      call_id: (call?.callId as string) ?? verification.call_id ?? null,
      contact_id: (call?.contactId as string) ?? verification.contact_id ?? null,
      attempt: (call?.attempts as number) ?? verification.attempt,
      outcome,
      sentiment: (call?.sentiment as string) ?? verification.sentiment ?? null,
      duration_sec: (call?.durationSec as number) ?? verification.duration_sec ?? null,
      summary: (call?.summary as string) ?? verification.summary ?? null,
      error: (call?.failureReason as string) ?? null,
    };

    const finished = status === 'completed' || status === 'no_answer' || status === 'failed';
    if (finished && !verification.ended_at) patch.ended_at = new Date().toISOString();

    // Only spend a transcript fetch + extraction once the call has actually ended. A connected
    // call's transcript lands a little after the session is closed, so keep retrying until we
    // have both the turns and an extraction.
    const alreadyExtracted = Array.isArray(verification.corrections) && verification.corrections.length > 0;
    const needsTranscript = finished && call?.callId && (!verification.transcript || !verification.result);
    if (needsTranscript && (!alreadyExtracted || !verification.transcript || !verification.result)) {
      try {
        const detail = (await uplift(`/realtime-assistants/sessions/${call.callId}/detail`)) as Record<string, unknown>;
        const transcript = normaliseTranscript(detail);
        if (transcript.length) {
          patch.transcript = transcript;
          const card = ((verification.payload as Record<string, unknown>)?.card ?? {}) as Record<string, unknown>;
          const extracted = await extract(transcript, card);
          if (extracted) {
            patch.corrections = extracted.corrections ?? [];
            patch.result = extracted;
            if (extracted.summary) patch.summary = extracted.summary;
            if (extracted.sentiment) patch.sentiment = extracted.sentiment;
            if (extracted.intent === 'wrong_person') patch.outcome = 'wrong_person';
            else if (extracted.intent === 'confirm') patch.outcome = 'confirmed';
            else if (extracted.intent === 'cancel') patch.outcome = 'cancelled';
            else if (extracted.intent === 'callback') patch.outcome = 'callback';
          }
        }
        // The session record carries its own summary and timing; use them when the LLM pass is off.
        const sessionSummary = detail.summary as Record<string, unknown> | undefined;
        if (!patch.summary && typeof sessionSummary?.headline === 'string') patch.summary = sessionSummary.headline;
        if (!patch.duration_sec && typeof detail.durationSec === 'number') patch.duration_sec = detail.durationSec;
      } catch (detailError) {
        patch.error = patch.error ?? (detailError instanceof Error ? detailError.message : String(detailError));
      }
    }

    const { data: updatedRow, error: updateError } = await admin
      .from('call_verifications')
      .update(patch)
      .eq('id', String(verification.id ?? ''))
      .select('*')
      .single();
    if (updateError) throw updateError;

    // Settle once: the poll that first sees a finished call with an extraction
    // applies the customer's fixes and, when Automate is on, the verdict.
    const updated = await maybeSettle(admin, updatedRow as Record<string, unknown>);

    // Bill the call once, as soon as we know how many seconds the agent talked.
    // Uplift charges a flat 12 PKR/minute, so one token is one second at 0.2 PKR.
    const seconds = Number(updated.duration_sec ?? 0);
    if (finished && seconds > 0) {
      const { error: usageError } = await admin.from('call_usage').insert({
        store_id: verification.store_id,
        verification_id: verification.id,
        order_id: verification.order_id,
        seconds,
        pkr: Math.round(seconds * 0.2 * 100) / 100,
      });
      // 23505 = the unique index on verification_id: already billed, nothing to do.
      if (usageError && usageError.code !== '23505') {
        console.error('call_usage insert failed', usageError.message);
      }
    }

    return json({ verification: updated });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
