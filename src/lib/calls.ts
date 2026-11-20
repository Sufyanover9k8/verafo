import { functionsBaseUrl, supabase } from './supabase'

/**
 * The website's half of the Verafo calling stack.
 *
 * Nothing here dials a phone itself. The same two edge functions the mobile app
 * uses do the work — `auto-verify` starts one Uplift AI call for one order and
 * `verify-status` asks Uplift how that call went — and `call-queue` owns the
 * automation settings (turning every order above the risk line into a call).
 * Keeping the browser on the same functions means a call placed from a desk and
 * a call placed from the app land in the same transcript, budget and history.
 */

export type CallStatus =
  | 'queued'
  | 'dialing'
  | 'in_call'
  | 'completed'
  /** The dial connected to nothing — Uplift reports it as its own terminal state. */
  | 'no_answer'
  | 'failed'
  /** One "t" — this is the provider's spelling, not a typo. */
  | 'canceled'

export interface Correction {
  field: 'name' | 'phone' | 'address' | 'city' | 'item' | string
  from?: string | null
  to: string
}

export interface Verification {
  id: string
  order_id: string
  status: CallStatus
  outcome: string | null
  summary: string | null
  corrections: Correction[] | null
  error: string | null
  applied?: boolean | null
  ended_at?: string | null
}

export interface CallSettings {
  store_id: string
  auto_call: boolean
  risk_threshold: number
  monthly_budget_pkr: number
  apply_mode: 'off' | 'local' | 'shopify'
  updated_at?: string | null
}

export interface QueueEntry {
  id: string
  store_id: string
  order_id: string
  status: 'waiting' | 'dialing' | 'done' | 'canceled' | 'failed'
  auto: boolean
  note: string | null
  created_at: string
  verification_id: string | null
}

/** Terminal call states — anything else means the phone is still being worked. */
export const LIVE_CALL: CallStatus[] = ['queued', 'dialing', 'in_call']

export class CallError extends Error {
  status: number
  detail: Record<string, unknown>

  constructor(message: string, status: number, detail: Record<string, unknown> = {}) {
    super(message)
    this.name = 'CallError'
    this.status = status
    this.detail = detail
  }
}

async function post<T>(fn: 'auto-verify' | 'verify-status' | 'call-queue', body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new CallError('Supabase is not configured.', 0)
  const base = functionsBaseUrl()
  if (!base) throw new CallError('Supabase is not configured.', 0)

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new CallError('You are signed out. Sign in again.', 401)

  const res = await fetch(`${base}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  let parsed: Record<string, unknown>
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    parsed = { error: text }
  }

  if (!res.ok) {
    throw new CallError(String(parsed.error ?? `Request failed (${res.status})`), res.status, parsed)
  }
  return parsed as T
}

/** Start one Uplift call for this order. Throws CallError on refusal. */
export const startOrderCall = (orderId: string) =>
  post<{ verification: Verification; enrolled?: number | null }>('auto-verify', { order_id: orderId })

/** Ask Uplift how a call is going (or how it ended). Also stores the transcript. */
export const readCall = (args: { verificationId?: string; orderId?: string }) =>
  post<{ verification: Verification }>('verify-status', {
    ...(args.verificationId ? { verification_id: args.verificationId } : {}),
    ...(args.orderId ? { order_id: args.orderId } : {}),
  })

export const readCallSettings = () =>
  post<{ stores: { id: string; name: string }[]; settings: CallSettings[] }>('call-queue', {
    action: 'settings',
  })

export const saveCallSettings = (
  storeId: string,
  patch: Partial<Pick<CallSettings, 'auto_call' | 'risk_threshold' | 'monthly_budget_pkr' | 'apply_mode'>>,
) =>
  post<{ settings: CallSettings; added?: number }>('call-queue', {
    action: 'save_settings',
    store_id: storeId,
    ...patch,
  })

export const readCallQueue = () =>
  post<{ queue: QueueEntry[]; settings: CallSettings[] }>('call-queue', { action: 'status' })

/**
 * One turn of a call, as `verify-status` stores it. `role` is normalised to
 * "agent" / "customer" when the provider's wording can be mapped.
 */
export interface TranscriptTurn {
  role: string
  text: string
  at?: string
}

/** A finished call, joined to the order it was about. */
export interface CallHistoryRow {
  id: string
  order_id: string
  store_id: string
  status: CallStatus
  outcome: string | null
  summary: string | null
  sentiment: string | null
  duration_sec: number | null
  error: string | null
  attempt: number | null
  corrections: Correction[] | null
  applied: Record<string, unknown> | null
  transcript: TranscriptTurn[] | null
  result: Record<string, unknown> | null
  created_at: string
  started_at: string | null
  ended_at: string | null
  orders?: {
    order_reference?: string | null
    buyer_phone: string
    product_name?: string | null
    product_category?: string | null
    price?: number | null
    quantity?: number | null
    city?: string | null
    address?: string | null
    ordered_at?: string | null
    order_fulfillment?: { customer_name: string | null; status: string | null } | null
    outcomes?: { status: string | null } | null
  } | null
}

/** The two decisions a human can take after seeing a call. */
export type CallDecision = 'approved' | 'rejected'

/**
 * Override what a call concluded.
 *
 * This writes the merchant's decision to `order_fulfillment` (the ship/no-ship
 * axis the Shopify app and the courier import also read) and records who
 * changed it, from what, and when, on the call itself. It deliberately does NOT
 * touch `outcomes`: whether the parcel was eventually accepted is the courier's
 * answer, and the two axes are measured separately.
 */
export async function overrideCallDecision(args: {
  verificationId: string
  orderId: string
  decision: CallDecision
  previous: { decision: string | null; outcome: string | null; applied: Record<string, unknown> | null }
}): Promise<void> {
  if (!supabase) throw new CallError('Supabase is not configured.', 0)
  const { data: session } = await supabase.auth.getUser()
  const now = new Date().toISOString()
  const email = session.user?.email ?? null

  const { error: decisionError } = await supabase.from('order_fulfillment').upsert(
    {
      order_id: args.orderId,
      status: args.decision,
      decided_by: 'merchant',
      decided_at: now,
    },
    { onConflict: 'order_id' },
  )
  if (decisionError) throw new CallError(decisionError.message, 0, { step: 'fulfillment' })

  const applied = {
    ...(args.previous.applied ?? {}),
    override: {
      at: now,
      by: session.user?.id ?? null,
      email,
      decision: args.decision,
      previous: { decision: args.previous.decision, outcome: args.previous.outcome },
    },
  }
  const { error: callError } = await supabase
    .from('call_verifications')
    .update({
      outcome: args.decision === 'approved' ? 'confirmed' : 'cancelled',
      applied,
    })
    .eq('id', args.verificationId)
  if (callError) throw new CallError(callError.message, 0, { step: 'verification' })
}

/** 0.62 → "62%". The threshold is stored as a 0–1 fraction. */
export const thresholdLabel = (fraction: number) => `${Math.round(fraction * 100)}%`

/** One plain sentence for a finished call, used in toasts and logs. */
export function describeOutcome(verification: Verification): { kind: 'success' | 'error' | 'info'; title: string } {
  if (verification.status === 'failed') {
    return { kind: 'error', title: verification.error || 'The call could not be placed' }
  }
  switch (verification.outcome) {
    case 'confirmed':
      return { kind: 'success', title: 'Call confirmed the order' }
    case 'cancelled':
      return { kind: 'error', title: 'Buyer cancelled the order' }
    case 'wrong_person':
      return { kind: 'error', title: 'The number reached the wrong person' }
    case 'no_answer':
    case 'busy':
      return { kind: 'info', title: 'No answer — the buyer did not pick up' }
    default:
      return { kind: 'info', title: 'Call finished without a clear answer' }
  }
}
