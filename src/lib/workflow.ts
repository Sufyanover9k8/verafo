import { supabase } from './supabase'
import { refreshFingerprint, startOrderCall } from './calls'

/**
 * The workflow board is one funnel over two axes the rest of the app already
 * keeps apart: whether Verafo ships the parcel (`order_fulfillment.status`) and
 * whether the courier ultimately handed it over (`outcomes.status`). The board
 * draws the first one and writes both where a move implies both, so the Orders,
 * Calls and Outcomes pages agree with the board immediately.
 */
export type Stage =
  | 'inbox' // waiting for a decision: too risky to wave through, or not called yet
  | 'queue' // a call exists: dialling now, or called and waiting for a verdict
  | 'to_deliver' // approved, not dispatched yet
  | 'declined' // refused by the merchant or the call, or brought back by the courier
  | 'delivered'

export type WorkflowEdge =
  | 'call_dial'
  | 'auto_accept'
  | 'call_ship'
  | 'call_refuse'
  | 'courier_delivered'
  | 'courier_returned'

export const EDGE_LABEL: Record<WorkflowEdge, string> = {
  call_dial: 'Risky orders are called automatically',
  auto_accept: 'Safe orders ship without a call',
  call_ship: 'A confirmed call ships the parcel',
  call_refuse: 'A cancelled call refuses the parcel',
  courier_delivered: 'Courier delivery marks it delivered',
  courier_returned: 'Courier refusal marks it returned',
}

/** What the switch actually changes, in the merchant's terms. */
export const EDGE_HINT: Record<WorkflowEdge, string> = {
  call_dial: 'Orders at or above your risk threshold are queued for a call without you asking.',
  auto_accept:
    'Orders below your risk threshold are approved on their own, so they reach the courier without anyone touching them.',
  call_ship: 'When the buyer confirms the order on the call, it moves to To deliver on its own.',
  call_refuse: 'When the buyer cancels on the call, it is declined and never leaves the shelf.',
  courier_delivered: 'When the courier reports a delivery, the order is marked delivered here.',
  courier_returned: 'When the courier reports a refusal, the parcel is marked declined here.',
}

export type Automation = Record<WorkflowEdge, boolean>

export const DEFAULT_AUTOMATION: Automation = {
  call_dial: true,
  auto_accept: true,
  call_ship: true,
  call_refuse: true,
  courier_delivered: true,
  courier_returned: true,
}

interface CallRow {
  status: string | null
  outcome: string | null
  created_at: string | null
}

/** One order as the board needs it, joined the way every other page joins it. */
export interface WorkflowOrder {
  id: string
  store_id: string
  buyer_phone: string
  order_reference: string | null
  product_name: string | null
  price: number | null
  quantity: number | null
  city: string | null
  ordered_at: string | null
  order_fulfillment: { status: string | null; customer_name: string | null; decided_by: string | null } | null
  outcomes: { status: string | null } | null
  buyers: { name: string | null; risk_score: number | null } | null
  call_verifications: CallRow[] | null
}

export const ORDER_FIELDS =
  'id, store_id, buyer_phone, order_reference, product_name, price, quantity, city, ordered_at, ' +
  'order_fulfillment(status, customer_name, decided_by), outcomes(status), buyers(name, risk_score), ' +
  'call_verifications(status, outcome, created_at)'

/** Which board a row belongs on. */
export function stageOf(order: WorkflowOrder): Stage {
  const calls = order.call_verifications ?? []
  const status = order.order_fulfillment?.status ?? 'pending_review'
  switch (status) {
    case 'approved':
      return 'to_deliver'
    case 'delivered':
      return 'delivered'
    case 'returned':
    case 'rejected':
      return 'declined'
    default:
      return calls.length ? 'queue' : 'inbox'
  }
}

/** The newest call on an order, for the one-line status under a queued card. */
export function latestCall(order: WorkflowOrder): CallRow | null {
  const calls = [...(order.call_verifications ?? [])]
  if (!calls.length) return null
  calls.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
  return calls[0]
}

/** Read every wire's switch; a wire with no row is on, which is the default. */
export async function readAutomation(storeId: string): Promise<Automation> {
  const next: Automation = { ...DEFAULT_AUTOMATION }
  if (!supabase) return next
  const { data, error } = await supabase
    .from('workflow_automation')
    .select('edge, enabled')
    .eq('store_id', storeId)
  if (error) return next
  for (const row of (data ?? []) as { edge: WorkflowEdge; enabled: boolean }[]) {
    if (row.edge in next) next[row.edge] = row.enabled
  }
  return next
}

/**
 * Flip one wire. `call_dial` is mirrored into `store_call_settings.auto_call`
 * because that is the switch the queue cron and the "Automate calls" button in
 * Orders read, and two switches for one behaviour would drift apart.
 */
export async function setAutomation(storeId: string, edge: WorkflowEdge, enabled: boolean): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase
    .from('workflow_automation')
    .upsert({ store_id: storeId, edge, enabled, updated_at: new Date().toISOString() }, { onConflict: 'store_id,edge' })
  if (error) throw new Error(error.message)

  if (edge === 'call_dial') {
    const { data } = await supabase.from('store_call_settings').select('store_id').eq('store_id', storeId).maybeSingle()
    const write = data
      ? supabase.from('store_call_settings').update({ auto_call: enabled, updated_at: new Date().toISOString() }).eq('store_id', storeId)
      : supabase.from('store_call_settings').insert({ store_id: storeId, auto_call: enabled })
    const { error: settingsError } = await write
    if (settingsError) throw new Error(settingsError.message)
  }
}

type Decision = 'approved' | 'rejected' | 'pending_review' | 'delivered' | 'returned'

interface Move {
  decision: Decision
  /** The courier axis, when the move decides it too. */
  outcome?: 'accepted' | 'refused' | 'pending'
  /** Dropped on the call queue: dial this order now. */
  call?: boolean
}

const MOVES: Record<Stage, Move> = {
  inbox: { decision: 'pending_review', outcome: 'pending' },
  queue: { decision: 'pending_review', call: true },
  to_deliver: { decision: 'approved' },
  declined: { decision: 'rejected', outcome: 'refused' },
  delivered: { decision: 'delivered', outcome: 'accepted' },
}

/**
 * Move a card. Refusing is a known outcome for the buyer, so it writes both
 * axes; approving only decides shipping, because whether the parcel is accepted
 * is still the courier's answer.
 */
export async function moveOrder(order: WorkflowOrder, target: Stage): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const move = MOVES[target]

  if (move.call) {
    await startOrderCall(order.id)
    return
  }

  const now = new Date().toISOString()
  const { error } = await supabase.from('order_fulfillment').upsert(
    {
      order_id: order.id,
      status: move.decision,
      decided_by: move.decision === 'pending_review' ? null : 'merchant',
      decided_at: move.decision === 'pending_review' ? null : now,
    },
    { onConflict: 'order_id' },
  )
  if (error) throw new Error(error.message)

  if (move.outcome) {
    const { error: outcomeError } = await supabase.from('outcomes').upsert(
      {
        order_id: order.id,
        status: move.outcome,
        resolved_at: move.outcome === 'pending' ? null : now,
      },
      { onConflict: 'order_id' },
    )
    if (outcomeError) throw new Error(outcomeError.message)
  }

  // A move changes what the network knows about this buyer, so the fingerprint
  // is rebuilt in the background rather than at the next map rebuild.
  void refreshFingerprint(order.buyer_phone)
}
