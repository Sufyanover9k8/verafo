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

export type CallStatus = 'queued' | 'dialing' | 'in_call' | 'completed' | 'failed' | 'canceled'

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
