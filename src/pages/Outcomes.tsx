import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Badge } from '../components/primitives/Badge'
import { Table, type Column } from '../components/primitives/Table'
import { EmptyState, NeedsSetup } from '../components/States'
import { dateTime, phone } from '../lib/format'
import { formatScore, riskLevel } from '../lib/risk'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { OrderRow, OutcomeStatus } from '../lib/types'

type Tab = 'pending' | 'resolved'

const EXIT_MS = 260

export function Outcomes() {
  const toast = useToast()
  const { store } = useStoreScope()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('pending')
  const [working, setWorking] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<Record<string, boolean>>({})
  const timers = useRef<number[]>([])

  const load = useCallback(async () => {
    if (!supabase) return
    let query = supabase
      .from('orders')
      .select('*, stores(name), outcomes(status, resolved_at, refusal_reason)')
    if (store) query = query.eq('store_id', store.id)
    const { data, error } = await query.order('ordered_at', { ascending: false }).limit(200)
    if (error) {
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
        <Link className="link" to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}>
          {phone(o.buyer_phone)}
        </Link>
      ),
    },
    {
      key: 'product',
      label: 'Product',
      render: (o) => (
        <span>
          {o.product_name || o.product_category || 'Untitled product'}
          {o.product_category && <span className="chip">{o.product_category}</span>}
        </span>
      ),
    },
    {
      key: 'store',
      label: 'Store',
      render: (o) => <span className="muted">{o.stores?.name ?? 'Unknown store'}</span>,
    },
    {
      key: 'price',
      label: 'Total',
      num: true,
      render: (o) => `${(o.price ?? 0).toLocaleString('en-PK')}${o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}`,
    },
    {
      key: 'ordered_at',
      label: 'Ordered',
      render: (o) => <span className="muted">{dateTime(o.ordered_at)}</span>,
    },
    {
      key: 'outcome',
      label: 'Outcome',
      className: 'outcome-cell',
      render: (o) => {
        const status = (o.outcomes?.status ?? 'pending') as OutcomeStatus
        if (status !== 'pending') return <Badge status={status} />
        return (
          <span className="outcome-cell">
            <button
              className="btn btn-accept btn-sm"
              disabled={working === o.id}
              onClick={() => void mark(o, 'accepted')}
            >
              {working === o.id ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="check" size={14} />} A
            </button>
            <button
              className="btn btn-refuse btn-sm"
              disabled={working === o.id}
              onClick={() => void mark(o, 'refused')}
            >
              {working === o.id ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="close" size={14} />} R
            </button>
          </span>
        )
      },
    },
  ]

  const visible = tab === 'pending' ? pending : resolved

  return (
    <div className="stack">
      <PageHeader
        icon="clipboard"
        title="Mark Outcome"
        subtitle={
          store
            ? `Recording outcomes for ${store.name} — every outcome instantly re-scores that buyer.`
            : 'After delivery, record accepted or refused. Every outcome instantly re-scores that buyer.'
        }
      />

      <div className="cluster">
        <div className="tabs">
          <button className={`tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
            Pending <span className="tab-count">{pending.length}</span>
          </button>
          <button className={`tab ${tab === 'resolved' ? 'active' : ''}`} onClick={() => setTab('resolved')}>
            Resolved <span className="tab-count">{resolved.length}</span>
          </button>
        </div>
        <button className="tab-refresh" onClick={() => void load()} title="Refresh">
          <Icon name="refresh" size={16} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="preview-loading card">
          <Icon name="refresh" size={20} className="spin" /> Loading orders…
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          {tab === 'pending' ? (
            <EmptyState
              icon="checkmark-done"
              title="No pending orders"
              detail="Everything is resolved. Log a new order to get it queued here."
            />
          ) : (
            <EmptyState icon="time" title="No resolved orders yet" detail="Marked outcomes will appear here." />
          )}
        </div>
      ) : (
        <div className="card card--flush">
          <Table
            columns={columns}
            rows={visible}
            rowKey={(o) => o.id}
            rowClassName={(o) => (leaving[o.id] ? 'out-table-row exit' : 'out-table-row')}
            onRowKeyDown={(o, key) => {
              if (o.outcomes?.status === 'pending') {
                void mark(o, key === 'a' ? 'accepted' : 'refused')
              }
            }}
            empty={<EmptyState icon="time" title="Nothing here" />}
          />
        </div>
      )}
    </div>
  )
}