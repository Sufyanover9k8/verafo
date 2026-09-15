import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Badge } from '../components/primitives/Badge'
import { Skeleton } from '../components/primitives/Skeleton'
import { Table, type Column } from '../components/primitives/Table'
import { VerdictChip } from '../components/verdict/VerdictChip'
import { Avatar } from '../components/Avatar'
import { Reveal } from '../components/Reveal'
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
        <span className="cell-avatar">
          <Avatar phone={o.buyer_phone} size={26} />
          <Link className="link" to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}>
            {phone(o.buyer_phone)}
          </Link>
        </span>
      ),
    },
    {
      key: 'risk',
      label: 'Risk',
      render: (o) => (
        <VerdictChip
          risk_score={o.buyers?.risk_score}
          total_orders={o.buyers?.total_orders}
          total_accepted={o.buyers?.total_accepted}
          total_refused={o.buyers?.total_refused}
        />
      ),
    },
    {
      key: 'product',
      label: 'Product',
      render: (o) => o.product_name || o.product_category || 'Untitled product',
    },
    ...(isAdmin
      ? [
          {
            key: 'store',
            label: 'Store',
            render: (o: Row) => <span className="muted">{o.stores?.name ?? '—'}</span>,
          } as Column<Row>,
        ]
      : []),
    {
      key: 'city',
      label: 'City',
      render: (o) => <span className="muted">{o.city || '—'}</span>,
    },
    {
      key: 'price',
      label: 'Total',
      num: true,
      render: (o) => `${money(o.price)}${o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}`,
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
        const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
        if (s !== 'pending') return <Badge status={s} />
        return (
          <span className="outcome-cell">
            <button
              className="btn btn-accept btn-sm"
              disabled={working === o.id}
              onClick={() => void mark(o, 'accepted')}
            >
              {working === o.id ? <Icon name="refresh" size={14} className="spin" /> : <Icon name="check" size={14} />} Accept
            </button>
            <button
              className="btn btn-refuse btn-sm"
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
    <div className="stack">
      <PageHeader
        icon="clipboard"
        title="Orders"
        subtitle={
          store
            ? `Every order for ${store.name}, with its buyer risk and outcome.`
            : 'Every order across your stores, with its buyer risk and outcome.'
        }
        actions={
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Icon name="download" size={14} /> Export CSV
          </button>
        }
      />

      <div className="card filter-bar">
        <div className="field">
          <span className="field-label">
            <Icon name="calendar" size={14} /> Order date
          </span>
          <div className="date-range">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="From date"
            />
            <Icon name="arrow-forward" size={13} className="date-range-sep" />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="To date"
            />
          </div>
        </div>
        <label className="field">
          <span className="field-label">
            <Icon name="phone-portrait" size={14} /> Phone
          </span>
          <input
            className="mono"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="03xx xxxxxxx"
            aria-label="Filter by phone"
          />
        </label>
        <label className="field">
          <span className="field-label">
            <Icon name="location" size={14} /> City
          </span>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Lahore"
            aria-label="Filter by city"
          />
        </label>

        {showMoreFilters && (
          <>
            <label className="field grow">
              <span className="field-label">Product</span>
              <input
                type="text"
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                placeholder="Product name or category"
                aria-label="Filter by product"
              />
            </label>
            {isAdmin && (
              <label className="field">
                <span className="field-label">Store</span>
                <select
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
          className="filter-toggle"
          onClick={() => setShowMoreFilters((v) => !v)}
        >
          <Icon name={showMoreFilters ? 'close' : 'add'} size={14} />
          {showMoreFilters ? 'Fewer filters' : 'Add more filters'}
        </button>

        <div className="filter-bar-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>
            <Icon name="search" size={14} /> Search
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters}>
            <Icon name="refresh" size={14} /> Reset
          </button>
        </div>
      </div>

      <div className="cluster">
        <div className="tabs">
          {(['all', 'pending', 'accepted', 'refused'] as StatusFilter[]).map((s) => (
            <button key={s} className={`tab ${status === s ? 'active' : ''}`} onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)} <span className="tab-count">{counts[s]}</span>
            </button>
          ))}
        </div>
        <button className="tab-refresh" onClick={() => void load()} title="Refresh">
          <Icon name="refresh" size={16} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="card">
          <div className="stack" style={{ padding: 'var(--s-2)' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="skeleton-row" key={i}>
                <Skeleton width="22%" height={14} />
                <Skeleton width="34%" height={14} />
                <Skeleton width="14%" height={14} />
              </div>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="clipboard"
            title="No orders match"
            detail={rows.length === 0 ? 'Orders will appear here as they come in.' : 'Try a different filter.'}
          />
        </div>
      ) : (
        <Reveal>
          <div className="card card--flush">
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
          </div>
        </Reveal>
      )}
    </div>
  )
}
