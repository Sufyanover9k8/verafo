import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Skeleton } from '../components/primitives/Skeleton'
import { Table, type Column } from '../components/primitives/Table'
import { VerdictBadge } from '../components/app/verdict-badge'
import { StatusBadge } from '../components/app/status-badge'
import { EmptyState, NeedsSetup } from '../components/States'
import { dateTime, money, normalizePhone, phone } from '../lib/format'
import { formatScore, riskLevel } from '../lib/risk'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { OrderRow, OutcomeStatus } from '../lib/types'

type StatusFilter = 'all' | 'pending' | 'accepted' | 'refused'

interface Row extends OrderRow {
  buyers?: {
    risk_score: number
    total_orders: number
    total_accepted: number
    total_refused: number
  } | null
}

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const keys = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n')
}

export function Orders() {
  const toast = useToast()
  const { role, store, stores: adminStores, scopeStoreIds } = useStoreScope()
  const isAdmin = role === 'admin'

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [term, setTerm] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [city, setCity] = useState('')
  const [product, setProduct] = useState('')
  const [filterStoreId, setFilterStoreId] = useState('')
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  const [working, setWorking] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setLoadError(false)
    let query = supabase
      .from('orders')
      .select(
        '*, stores(name), buyers(risk_score, total_orders, total_accepted, total_refused), outcomes(status, resolved_at, refusal_reason)',
      )
    if (store) query = query.eq('store_id', store.id)
    else if (scopeStoreIds) query = query.in('store_id', scopeStoreIds)
    if (isAdmin && filterStoreId) query = query.eq('store_id', filterStoreId)
    if (dateFrom) query = query.gte('ordered_at', new Date(dateFrom).toISOString())
    if (dateTo) query = query.lte('ordered_at', new Date(`${dateTo}T23:59:59`).toISOString())

    const { data, error } = await query.order('ordered_at', { ascending: false }).limit(500)
    if (error) {
      setLoadError(true)
      toast.push({ kind: 'error', title: 'Could not load orders', detail: error.message })
    } else {
      setRows((data ?? []) as unknown as Row[])
    }
    setLoading(false)
  }, [toast, store, scopeStoreIds, isAdmin, filterStoreId, dateFrom, dateTo])

  useEffect(() => {
    void load()
  }, [load])

  function resetFilters() {
    setStatus('all')
    setTerm('')
    setDateFrom('')
    setDateTo('')
    setCity('')
    setProduct('')
    setFilterStoreId('')
  }

  const filtered = useMemo(() => {
    const q = normalizePhone(term)
    const c = city.trim().toLowerCase()
    const p = product.trim().toLowerCase()
    return rows.filter((o) => {
      const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
      if (status !== 'all' && s !== status) return false
      if (q && !normalizePhone(o.buyer_phone).includes(q)) return false
      if (c && !(o.city ?? '').toLowerCase().includes(c)) return false
      if (p && !`${o.product_name ?? ''} ${o.product_category ?? ''}`.toLowerCase().includes(p)) return false
      return true
    })
  }, [rows, status, term, city, product])

  const counts = useMemo(() => {
    const c = { all: rows.length, pending: 0, accepted: 0, refused: 0 }
    for (const o of rows) {
      const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
      c[s]++
    }
    return c
  }, [rows])

  async function mark(order: Row, next: 'accepted' | 'refused') {
    if (!supabase || working) return
    setWorking(order.id)
    try {
      const { error } = await supabase
        .from('outcomes')
        .upsert(
          { order_id: order.id, status: next, resolved_at: new Date().toISOString() },
          { onConflict: 'order_id' },
        )
      if (error) throw error
      const { data: buyer } = await supabase
        .from('buyers')
        .select('risk_score')
        .eq('phone', order.buyer_phone)
        .maybeSingle()
      const score = buyer?.risk_score ?? 0.5
      toast.push({
        kind: 'success',
        title: next === 'accepted' ? 'Marked accepted' : 'Marked refused',
        detail: `${phone(order.buyer_phone)} — risk ${formatScore(score)} (${riskLevel(score)})`,
      })
      void load()
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not update outcome',
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setWorking(null)
    }
  }

  function exportCsv() {
    const out = filtered.map((o) => ({
      buyer_phone: o.buyer_phone,
      store: o.stores?.name ?? '',
      product: o.product_name || o.product_category || '',
      city: o.city ?? '',
      total: (o.price ?? 0) * (o.quantity ?? 1),
      risk_score: o.buyers?.risk_score ?? '',
      ordered_at: o.ordered_at ?? '',
      outcome: o.outcomes?.status ?? 'pending',
    }))
    const blob = new Blob([csv(out)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `verafo-orders-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!isConfigured) return <NeedsSetup />

  const columns: Column<Row>[] = [
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
      key: 'price',
      label: 'Amount',
      num: true,
      render: (o) => `${money(o.price)}${o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}`,
    },
    {
      key: 'risk',
      label: 'Risk',
      render: (o) => (
        <VerdictBadge
          riskScore={o.buyers?.risk_score}
          totalOrders={o.buyers?.total_orders}
        />
      ),
    },
    {
      key: 'outcome',
      label: 'Status',
      render: (o) => {
        const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
        return <StatusBadge status={s} />
      },
    },
    {
      key: 'ordered_at',
      label: 'Date',
      render: (o) => <span className="text-muted-foreground">{dateTime(o.ordered_at)}</span>,
    },
    {
      key: 'product',
      label: 'Product',
      render: (o) => o.product_name || o.product_category || 'Untitled product',
    },
    {
      key: 'city',
      label: 'City',
      render: (o) => <span className="text-muted-foreground">{o.city || '—'}</span>,
    },
    ...(isAdmin
      ? [
          {
            key: 'store',
            label: 'Store',
            render: (o: Row) => <span className="text-muted-foreground">{o.stores?.name ?? '—'}</span>,
          } as Column<Row>,
        ]
      : []),
    {
      key: 'actions',
      label: 'Action',
      render: (o) => {
        const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
        if (s !== 'pending') return <span className="text-[13px] text-muted-foreground">—</span>
        return (
          <span className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted md:h-9"
              disabled={working === o.id}
              onClick={() => void mark(o, 'accepted')}
            >
              {working === o.id ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="check" size={14} />} Accept
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-risk-high/40 px-3 text-[13px] font-semibold text-risk-high-strong transition-colors hover:bg-risk-high-soft md:h-9"
              disabled={working === o.id}
              onClick={() => void mark(o, 'refused')}
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
        title="Orders"
        description={
          store
            ? `Every order for ${store.name}, with its buyer risk and outcome.`
            : 'Every order across your stores, with its buyer risk and outcome.'
        }
        actions={
          <button
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-border bg-card px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50 md:h-9"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Icon name="download" size={14} /> Export CSV
          </button>
        }
      />

      {/* Filters. */}
      <div className="rounded-[16px] border border-border bg-card p-6">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex min-w-[150px] flex-col gap-2">
            <span className="text-[13px] font-medium text-muted-foreground">Order date</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="h-11 w-full min-w-[130px] rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground md:h-10"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
              />
              <span className="text-muted-foreground" aria-hidden="true">
                →
              </span>
              <input
                type="date"
                className="h-11 w-full min-w-[130px] rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground md:h-10"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
              />
            </div>
          </label>

          <label className="flex min-w-[150px] flex-1 flex-col gap-2">
            <span className="text-[13px] font-medium text-muted-foreground">Phone</span>
            <input
              className="h-11 w-full rounded-[10px] border border-input bg-card px-3 font-mono text-[15px] text-foreground placeholder:text-muted-foreground md:h-10"
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="03xx xxxxxxx"
              aria-label="Filter by phone"
            />
          </label>

          <label className="flex min-w-[150px] flex-1 flex-col gap-2">
            <span className="text-[13px] font-medium text-muted-foreground">City</span>
            <input
              className="h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground placeholder:text-muted-foreground md:h-10"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Lahore"
              aria-label="Filter by city"
            />
          </label>

          {showMoreFilters && (
            <>
              <label className="flex min-w-[150px] flex-1 flex-col gap-2">
                <span className="text-[13px] font-medium text-muted-foreground">Product</span>
                <input
                  className="h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground placeholder:text-muted-foreground md:h-10"
                  type="text"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  placeholder="Product name or category"
                  aria-label="Filter by product"
                />
              </label>
              {isAdmin && (
                <label className="flex min-w-[150px] flex-col gap-2">
                  <span className="text-[13px] font-medium text-muted-foreground">Store</span>
                  <select
                    className="h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground md:h-10"
                    value={filterStoreId}
                    onChange={(e) => setFilterStoreId(e.target.value)}
                    aria-label="Filter by store"
                  >
                    <option value="">All stores</option>
                    {adminStores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          <button
            type="button"
            className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-dashed border-input px-4 text-[13px] font-semibold text-primary-text transition-colors hover:bg-muted md:h-10"
            onClick={() => setShowMoreFilters((v) => !v)}
          >
            <Icon name={showMoreFilters ? 'close' : 'add'} size={14} />
            {showMoreFilters ? 'Fewer filters' : 'Add more filters'}
          </button>

          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 md:h-10"
              onClick={() => void load()}
            >
              <Icon name="search" size={14} /> Search
            </button>
            <button
              type="button"
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-border bg-card px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted md:h-10"
              onClick={resetFilters}
            >
              <Icon name="refresh" size={14} /> Reset
            </button>
          </div>
        </div>
      </div>

      {/* Status filter and refresh. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex gap-1 rounded-[10px] border border-border bg-card p-1">
          {(['all', 'pending', 'accepted', 'refused'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={status === s}
              className={`inline-flex h-11 items-center gap-2 rounded-[10px] px-3 text-[13px] font-semibold transition-colors md:h-8 ${
                status === s ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setStatus(s)}
            >
              {s[0].toUpperCase() + s.slice(1)}
              <span className="rounded-full bg-muted px-2 text-[12px] tabular-nums">{counts[s]}</span>
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

      {/* The table. Wide tables scroll inside this box, never the page. */}
      <div className="overflow-hidden rounded-[16px] border border-border bg-card">
        {loading ? (
          <div className="flex flex-col gap-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={16} />
            ))}
          </div>
        ) : loadError ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-[15px] text-foreground">We could not load your orders.</p>
            <button
              type="button"
              className="inline-flex h-11 items-center rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground hover:bg-muted md:h-9"
              onClick={() => void load()}
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title={rows.length === 0 ? 'No orders yet' : 'No orders match'}
            detail={rows.length === 0 ? 'Orders will appear here as they come in.' : 'Try a different filter.'}
          />
        ) : (
          <Table
            columns={columns}
            rows={filtered}
            rowKey={(o) => o.id}
            onRowKeyDown={(o, key) => {
              if ((o.outcomes?.status ?? 'pending') === 'pending') {
                void mark(o, key === 'a' ? 'accepted' : 'refused')
              }
            }}
          />
        )}
      </div>
    </PageShell>
  )
}
