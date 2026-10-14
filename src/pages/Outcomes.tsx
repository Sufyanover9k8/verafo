import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { StatusBadge } from '../components/app/status-badge'
import { Skeleton } from '../components/primitives/Skeleton'
import { Table, type Column } from '../components/primitives/Table'
import { EmptyState, NeedsSetup } from '../components/States'
import { dateTime, money, phone } from '../lib/format'
import { formatScore, riskLevel } from '../lib/risk'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { OrderRow, OutcomeStatus } from '../lib/types'

type Tab = 'pending' | 'resolved'

const EXIT_MS = 260

const btnBase =
  'inline-flex h-11 items-center gap-1.5 rounded-[10px] border px-3 text-[13px] font-semibold transition-colors disabled:opacity-50 md:h-9'

export function Outcomes() {
  const toast = useToast()
  const { store } = useStoreScope()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [working, setWorking] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<Record<string, boolean>>({})
  const timers = useRef<number[]>([])

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setLoadError(false)
    let query = supabase
      .from('orders')
      .select('*, stores(name), outcomes(status, resolved_at, refusal_reason)')
    if (store) query = query.eq('store_id', store.id)
    const { data, error } = await query.order('ordered_at', { ascending: false }).limit(200)
    if (error) {
      setLoadError(true)
      toast.push({ kind: 'error', title: 'Could not load orders', detail: error.message })
    } else {
      setOrders((data ?? []) as OrderRow[])
    }
    setLoading(false)
  }, [toast, store])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])

  const pending = orders.filter((o) => !o.outcomes || o.outcomes.status === 'pending')
  const resolved = orders.filter((o) => o.outcomes && o.outcomes.status !== 'pending').slice(0, 50)
  const visible = tab === 'pending' ? pending : resolved

  async function mark(order: OrderRow, status: 'accepted' | 'refused') {
    if (!supabase || working) return
    setWorking(order.id)
    try {
      const { error } = await supabase.from('outcomes').upsert(
        { order_id: order.id, status, resolved_at: new Date().toISOString() },
        { onConflict: 'order_id' },
      )
      if (error) throw error

      const { data: buyer, error: bErr } = await supabase
        .from('buyers')
        .select('risk_score')
        .eq('phone', order.buyer_phone)
        .maybeSingle()
      if (bErr) throw bErr

      setLeaving((prev) => ({ ...prev, [order.id]: true }))
      const score = buyer?.risk_score ?? 0.5
      toast.push({
        kind: 'success',
        title: status === 'accepted' ? 'Marked as accepted' : 'Marked as refused',
        detail: `${phone(order.buyer_phone)} — new risk score ${formatScore(score)} (${riskLevel(score)})`,
      })
      timers.current.push(window.setTimeout(() => void load(), EXIT_MS))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({ kind: 'error', title: 'Could not update outcome', detail: message })
    } finally {
      setWorking(null)
    }
  }

  if (!isConfigured) return <NeedsSetup />

  const columns: Column<OrderRow>[] = [
    {
      key: 'buyer',
      label: 'Buyer',
      id: true,
      render: (o) => (
        <Link className="font-mono text-[13px] font-medium text-primary-text hover:underline" to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}>
          {phone(o.buyer_phone)}
        </Link>
      ),
    },
    {
      key: 'product',
      label: 'Product',
      // 'wrap' lets this cell break onto a second line, which is what makes the
      // whole table fit at 100% zoom (see .out-table in components.css).
      className: 'wrap',
      render: (o) => o.product_name || o.product_category || 'Untitled product',
    },
    {
      key: 'store',
      label: 'Store',
      render: (o) => <span className="text-muted-foreground">{o.stores?.name ?? 'Unknown store'}</span>,
    },
    {
      key: 'price',
      label: 'Amount',
      num: true,
      render: (o) => `${money(o.price)}${o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}`,
    },
    {
      key: 'ordered_at',
      label: 'Date',
      render: (o) => <span className="text-muted-foreground">{dateTime(o.ordered_at)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (o) => <StatusBadge status={(o.outcomes?.status ?? 'pending') as OutcomeStatus} />,
    },
    {
      key: 'outcome',
      label: 'Mark',
      render: (o) => {
        const status = (o.outcomes?.status ?? 'pending') as OutcomeStatus
        if (status !== 'pending') return <span className="text-[13px] text-muted-foreground">—</span>
        return (
          <span className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={`${btnBase} border-risk-safe/40 text-risk-safe-strong hover:bg-risk-safe-soft`}
              disabled={working === o.id}
              onClick={() => void mark(o, 'accepted')}
              aria-label={`Mark ${phone(o.buyer_phone)} as accepted`}
            >
              {working === o.id ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="check" size={14} />} Accept
            </button>
            <button
              type="button"
              className={`${btnBase} border-risk-high/40 text-risk-high-strong hover:bg-risk-high-soft`}
              disabled={working === o.id}
              onClick={() => void mark(o, 'refused')}
              aria-label={`Mark ${phone(o.buyer_phone)} as refused`}
            >
              {working === o.id ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="close" size={14} />} Refuse
            </button>
          </span>
        )
      },
    },
  ]

  return (
    <PageShell>
      <PageHeader
        title="Outcomes"
        description={
          store
            ? `Recording outcomes for ${store.name} — every outcome instantly re-scores that buyer.`
            : 'After delivery, record accepted or refused. Every outcome instantly re-scores that buyer.'
        }
      />

      {/* Pending / resolved, and refresh. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-[10px] border border-border bg-card p-1">
          {(['pending', 'resolved'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              className={`inline-flex h-11 items-center gap-2 rounded-[10px] px-3 text-[13px] font-semibold transition-colors md:h-8 ${
                tab === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setTab(t)}
            >
              {t === 'pending' ? 'Pending' : 'Resolved'}
              <span className="rounded-full bg-muted px-2 text-[12px] tabular-nums">
                {t === 'pending' ? pending.length : resolved.length}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted md:h-9"
          onClick={() => void load()}
        >
          <Icon name="refresh" size={16} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-[16px] border border-border bg-card">
        {loading ? (
          <div className="flex flex-col gap-3 p-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={16} />
            ))}
          </div>
        ) : loadError ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-[15px] text-foreground">We could not load your orders.</p>
            <button type="button" className={`${btnBase} border-border`} onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={tab === 'pending' ? 'checkmark-done' : 'time'}
            title={tab === 'pending' ? 'No pending orders' : 'No resolved orders yet'}
            detail={
              tab === 'pending'
                ? 'Everything is resolved. Log a new order to get it queued here.'
                : 'Marked outcomes will appear here.'
            }
          />
        ) : (
          <div className="out-table">
            <Table
              columns={columns}
              rows={visible}
              rowKey={(o) => o.id}
              rowClassName={(o) => (leaving[o.id] ? 'out-table-row exit' : 'out-table-row')}
              onRowKeyDown={(o, key) => {
                if ((o.outcomes?.status ?? 'pending') === 'pending') {
                  void mark(o, key === 'a' ? 'accepted' : 'refused')
                }
              }}
            />
          </div>
        )}
      </div>
    </PageShell>
  )
}
