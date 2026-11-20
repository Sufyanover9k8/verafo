import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { StatStrip } from '../components/app/stat-strip'
import { Table, type Column } from '../components/primitives/Table'
import { EmptyState, NeedsSetup } from '../components/States'
import { LIVE_CALL, overrideCallDecision, type CallDecision, type CallHistoryRow } from '../lib/calls'
import { dateTime, money, phone } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'

type Tab = 'all' | 'connected' | 'no_answer' | 'changed' | 'failed'

const CALL_TONE: Record<string, string> = {
  confirmed: 'border-risk-safe/40 bg-risk-safe-soft text-risk-safe-strong',
  cancelled: 'border-risk-high/40 bg-risk-high-soft text-risk-high-strong',
  wrong_person: 'border-risk-high/40 bg-risk-high-soft text-risk-high-strong',
  no_answer: 'border-border bg-muted text-muted-foreground',
  failed: 'border-risk-high/40 bg-risk-high-soft text-risk-high-strong',
  unknown: 'border-border bg-muted text-muted-foreground',
}

const DECISION_LABEL: Record<string, string> = {
  approved: 'Ship',
  rejected: 'Refuse',
  pending_review: 'Waiting',
  delivered: 'Delivered',
  returned: 'Returned',
}

/** Who took the ship/refuse decision, in the merchant's words. */
const DECIDED_BY_LABEL: Record<string, string> = {
  automate: 'set by auto-call',
  call: 'set by the call',
  merchant: 'set by you',
}

/** One plain phrase for the state of the call itself. */
function callLabel(call: CallHistoryRow): string {
  if (LIVE_CALL.includes(call.status)) return 'In progress'
  if (call.status === 'failed') return 'Failed'
  if (call.status === 'canceled') return 'Canceled'
  if (call.status === 'no_answer') return 'No answer'
  switch (call.outcome) {
    case 'confirmed':
      return 'Confirmed'
    case 'cancelled':
      return 'Cancelled'
    case 'wrong_person':
      return 'Wrong person'
    case 'callback':
      return 'Callback'
    default:
      return 'Completed'
  }
}

function durationLabel(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

/** The corrections a call produced, for example "address: … → …". */
function CorrectionList({ corrections }: { corrections: CallHistoryRow['corrections'] }) {
  if (!corrections || corrections.length === 0) return null
  return (
    <ul className="flex list-none flex-col gap-1.5 pl-0">
      {corrections.map((c, i) => (
        <li key={`${c.field}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {c.field}
          </span>
          <span className="font-medium text-foreground">{c.to}</span>
        </li>
      ))}
    </ul>
  )
}

function Transcript({ turns }: { turns: CallHistoryRow['transcript'] }) {
  if (!turns || turns.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No transcript was stored for this call — Uplift only returns one for calls that connected.
      </p>
    )
  }
  return (
    <ol className="flex flex-col gap-3">
      {turns.map((t, i) => {
        const agent = t.role === 'agent'
        return (
          <li key={i} className={agent ? 'flex flex-col items-start' : 'flex flex-col items-end'}>
            <span className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {agent ? 'Verafo agent' : t.role === 'customer' ? 'Customer' : t.role}
            </span>
            <span
              className={
                agent
                  ? 'max-w-[85%] rounded-[12px] rounded-tl-[4px] bg-muted px-3 py-2 text-[13px] leading-relaxed text-foreground'
                  : 'max-w-[85%] rounded-[12px] rounded-tr-[4px] bg-[var(--accent-soft,#e6fafa)] px-3 py-2 text-[13px] leading-relaxed text-foreground'
              }
            >
              {t.text}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export function Calls() {
  const toast = useToast()
  const { store } = useStoreScope()
  const [calls, setCalls] = useState<CallHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [working, setWorking] = useState<CallDecision | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    let query = supabase
      .from('call_verifications')
      .select(
        'id, order_id, store_id, status, outcome, summary, sentiment, duration_sec, error, attempt, corrections, applied, transcript, result, created_at, started_at, ended_at, orders(order_reference, buyer_phone, product_name, product_category, price, quantity, city, address, ordered_at, order_fulfillment(customer_name, status, decided_by), outcomes(status))',
      )
    if (store) query = query.eq('store_id', store.id)
    const { data, error } = await query.order('created_at', { ascending: false }).limit(200)
    if (error) {
      toast.push({ kind: 'error', title: 'Could not load call history', detail: error.message })
    } else {
      setCalls((data ?? []) as unknown as CallHistoryRow[])
    }
    setLoading(false)
  }, [store, toast])

  useEffect(() => {
    void load()
  }, [load])

  // A call in progress changes state without anybody touching this page.
  const hasLive = calls.some((c) => LIVE_CALL.includes(c.status))
  useEffect(() => {
    if (!hasLive) return
    const id = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(id)
  }, [hasLive, load])

  const selected = useMemo(() => calls.find((c) => c.id === selectedId) ?? null, [calls, selectedId])

  const counts = useMemo(() => {
    const out = { all: calls.length, connected: 0, no_answer: 0, changed: 0, failed: 0 }
    for (const c of calls) {
      if (c.status === 'completed') out.connected += 1
      if (c.status === 'no_answer' || c.outcome === 'no_answer') out.no_answer += 1
      if ((c.corrections?.length ?? 0) > 0) out.changed += 1
      if (c.status === 'failed') out.failed += 1
    }
    return out
  }, [calls])

  const visible = useMemo(() => {
    switch (tab) {
      case 'connected':
        return calls.filter((c) => c.status === 'completed')
      case 'no_answer':
        return calls.filter((c) => c.status === 'no_answer' || c.outcome === 'no_answer')
      case 'changed':
        return calls.filter((c) => (c.corrections?.length ?? 0) > 0)
      case 'failed':
        return calls.filter((c) => c.status === 'failed')
      default:
        return calls
    }
  }, [calls, tab])

  async function decide(call: CallHistoryRow, decision: CallDecision) {
    if (working) return
    setWorking(decision)
    try {
      await overrideCallDecision({
        verificationId: call.id,
        orderId: call.order_id,
        decision,
        buyerPhone: call.orders?.buyer_phone ?? null,
        previous: {
          decision: call.orders?.order_fulfillment?.status ?? null,
          outcome: call.outcome,
          applied: call.applied,
        },
      })
      toast.push({
        kind: 'success',
        title: decision === 'approved' ? 'Marked to ship' : 'Marked to refuse',
        detail: 'The call now records your decision, with who changed it and what it was before.',
      })
      await load()
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not change the decision',
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setWorking(null)
    }
  }

  if (!isConfigured) return <NeedsSetup />

  const columns: Column<CallHistoryRow>[] = [
    {
      key: 'buyer',
      label: 'Buyer',
      id: true,
      render: (c) => {
        const buyerPhone = c.orders?.buyer_phone ?? ''
        const name = c.orders?.order_fulfillment?.customer_name ?? null
        return (
          <Link
            className="block min-w-0 hover:underline"
            to={`/lookup?phone=${encodeURIComponent(buyerPhone)}`}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="block truncate text-[13px] font-medium text-primary-text">
              {name ?? phone(buyerPhone)}
            </span>
            {name ? (
              <span className="block font-mono text-[11px] text-muted-foreground">{phone(buyerPhone)}</span>
            ) : null}
          </Link>
        )
      },
    },
    {
      key: 'order',
      label: 'Order',
      className: 'wrap',
      render: (c) => (
        <span className="flex flex-col">
          <span className="text-[13px]">{c.orders?.product_name ?? c.orders?.product_category ?? 'Order'}</span>
          <span className="text-[11px] text-muted-foreground">
            {[c.orders?.order_reference, money(c.orders?.price)].filter(Boolean).join(' · ')}
          </span>
        </span>
      ),
    },
    {
      key: 'when',
      label: 'When',
      render: (c) => (
        <span className="flex flex-col">
          <span className="text-[13px] text-muted-foreground">{dateTime(c.created_at)}</span>
          <span className="text-[11px] text-muted-foreground">{durationLabel(c.duration_sec)}</span>
        </span>
      ),
    },
    {
      key: 'call',
      label: 'Call',
      render: (c) => (
        <span
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${
            CALL_TONE[c.status === 'failed' ? 'failed' : (c.outcome ?? 'unknown')] ?? CALL_TONE.unknown
          }`}
        >
          {LIVE_CALL.includes(c.status) ? (
            <Icon name="refresh" size={11} className="spin" />
          ) : (
            <span className="size-1.5 rounded-full bg-current opacity-70" />
          )}
          {callLabel(c)}
        </span>
      ),
    },
    {
      key: 'changed',
      label: 'What changed',
      render: (c) => {
        const fields = [...new Set((c.corrections ?? []).map((x) => x.field))]
        if (fields.length === 0) return <span className="text-[13px] text-muted-foreground">—</span>
        return (
          <span className="text-[13px]">
            {fields.map((f) => (
              <span
                key={f}
                className="me-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground"
              >
                {f}
              </span>
            ))}
          </span>
        )
      },
    },
    {
      key: 'decision',
      label: 'Decision',
      render: (c) => {
        const status = c.orders?.order_fulfillment?.status ?? null
        const decidedBy = (c.orders?.order_fulfillment as { decided_by?: string | null } | null)?.decided_by
        const tone =
          status === 'approved' || status === 'delivered'
            ? 'text-risk-safe-strong'
            : status === 'rejected' || status === 'returned'
              ? 'text-risk-high-strong'
              : 'text-muted-foreground'
        return (
          <span className="flex flex-col">
            <span className={`text-[13px] font-medium ${tone}`}>
              {status ? (DECISION_LABEL[status] ?? status) : 'Waiting'}
            </span>
            {decidedBy ? (
              <span className="text-[11px] text-muted-foreground">
                {DECIDED_BY_LABEL[decidedBy] ?? decidedBy}
              </span>
            ) : null}
          </span>
        )
      },
    },
    {
      key: 'delivery',
      label: 'Courier',
      render: (c) => {
        const s = c.orders?.outcomes?.status ?? 'pending'
        const tone =
          s === 'accepted' ? 'text-risk-safe-strong' : s === 'refused' ? 'text-risk-high-strong' : 'text-muted-foreground'
        return (
          <span className={`text-[13px] ${tone}`}>
            {s === 'accepted' ? 'Accepted' : s === 'refused' ? 'Refused' : 'Not reported'}
          </span>
        )
      },
    },
    {
      key: 'open',
      label: '',
      render: (c) => (
        <button
          type="button"
          className="btn btn-ghost btn-sm whitespace-nowrap"
          onClick={(e) => {
            e.stopPropagation()
            setSelectedId(c.id === selectedId ? null : c.id)
          }}
        >
          {c.id === selectedId ? 'Hide' : 'Open'} <Icon name="chevron-down" size={14} />
        </button>
      ),
    },
  ]

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'connected', label: 'Connected', count: counts.connected },
    { key: 'no_answer', label: 'No answer', count: counts.no_answer },
    { key: 'changed', label: 'Changed something', count: counts.changed },
    { key: 'failed', label: 'Failed', count: counts.failed },
  ]

  const decided = calls.filter((c) => {
    const s = c.orders?.order_fulfillment?.status
    return s === 'approved' || s === 'rejected'
  }).length

  return (
    <PageShell>
      <PageHeader
        title="Calls"
        description="Every AI call Verafo placed for your orders: what was said, what the call changed, and the decision it left behind."
        actions={
          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted md:h-9"
            onClick={() => void load()}
          >
            <Icon name="refresh" size={16} className={loading ? 'spin' : ''} /> Refresh
          </button>
        }
      />

      <StatStrip
        loading={loading && calls.length === 0}
        items={[
          { label: 'Calls placed', value: counts.all, hint: store ? store.name : 'All your stores' },
          {
            label: 'Reached the buyer',
            value: counts.connected,
            hint: `${counts.all === 0 ? 0 : Math.round((counts.connected / counts.all) * 100)}% of calls`,
          },
          { label: 'Changed an address or item', value: counts.changed, hint: 'Applied to the order' },
          { label: 'Orders decided from a call', value: decided, hint: 'Ship or refuse, set by you or the call' },
        ]}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-[10px] border border-border bg-card p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tab === t.key}
              className={`inline-flex h-11 items-center gap-2 rounded-[10px] px-3 text-[13px] font-semibold transition-colors md:h-8 ${
                tab === t.key ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              <span className="rounded-full bg-muted px-2 text-[12px] tabular-nums">{t.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* The open call */}
      {selected ? (
        <section className="rounded-[14px] border border-border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold text-foreground">
                  {selected.orders?.order_fulfillment?.customer_name ?? phone(selected.orders?.buyer_phone)}
                </h2>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${
                    CALL_TONE[selected.status === 'failed' ? 'failed' : (selected.outcome ?? 'unknown')] ??
                    CALL_TONE.unknown
                  }`}
                >
                  {callLabel(selected)}
                </span>
              </div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {[
                  selected.orders?.order_reference,
                  selected.orders?.product_name ?? selected.orders?.product_category,
                  money(selected.orders?.price),
                  durationLabel(selected.duration_sec),
                  dateTime(selected.started_at ?? selected.created_at),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedId(null)}>
              Close <Icon name="close" size={14} />
            </button>
          </div>

          {selected.error ? (
            <p className="mb-4 rounded-[10px] border border-risk-high/40 bg-risk-high-soft px-3 py-2 text-[13px] text-risk-high-strong">
              {selected.error}
            </p>
          ) : null}

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="flex flex-col gap-3">
              <p className="text-[13px] leading-relaxed text-foreground">
                {selected.summary ?? 'The call finished without a written summary.'}
                {selected.sentiment ? (
                  <span className="text-muted-foreground"> · {selected.sentiment}</span>
                ) : null}
              </p>

              <CorrectionList corrections={selected.corrections} />

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-3.5 text-[12.5px] font-semibold text-[var(--cta-fg)] transition-colors hover:bg-[var(--cta-bg-hover)] disabled:opacity-60"
                  disabled={working != null}
                  onClick={() => void decide(selected, 'approved')}
                >
                  {working === 'approved' ? (
                    <Icon name="refresh" size={14} className="spin" />
                  ) : (
                    <Icon name="check" size={14} />
                  )}
                  Ship it
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-risk-high/45 bg-card px-3.5 text-[12.5px] font-semibold text-risk-high-strong transition-colors hover:bg-risk-high-soft disabled:opacity-60"
                  disabled={working != null}
                  onClick={() => void decide(selected, 'rejected')}
                >
                  {working === 'rejected' ? (
                    <Icon name="refresh" size={14} className="spin" />
                  ) : (
                    <Icon name="close" size={14} />
                  )}
                  Refuse it
                </button>
                <Link className="btn btn-ghost btn-sm" to={`/lookup?phone=${encodeURIComponent(selected.orders?.buyer_phone ?? '')}`}>
                  Buyer profile
                </Link>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Conversation
              </h3>
              <div className="max-h-[420px] overflow-y-auto pe-1">
                <Transcript turns={selected.transcript} />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {loading && calls.length === 0 ? (
        <div className="rounded-[14px] border border-border bg-card p-6 text-[13px] text-muted-foreground">
          Loading call history…
        </div>
      ) : (
        <Table
          columns={columns}
          rows={visible}
          rowKey={(c) => c.id}
          empty={
            <EmptyState
              icon="chatbubbles"
              title={calls.length === 0 ? 'No calls yet' : 'Nothing in this filter'}
              detail={
                calls.length === 0
                  ? 'Calls start from the Call button on an order, or automatically once auto-call is on in Settings. They show up here with the transcript and the decision.'
                  : 'Try another tab — this filter has no calls in it.'
              }
            />
          }
        />
      )}

      <p className="text-[12px] text-muted-foreground">
        Calls above your risk threshold are placed automatically when auto-call is on. Every call writes its
        transcript, its corrections and its decision here, and the corrections also land on the order itself.
      </p>
    </PageShell>
  )
}

export default Calls
