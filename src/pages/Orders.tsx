import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Download, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { StatStrip, type StatItem } from '../components/app/stat-strip'
import { Skeleton } from '../components/primitives/Skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { VerdictBadge } from '../components/app/verdict-badge'
import { StatusBadge } from '../components/app/status-badge'
import { EmptyState, NeedsSetup } from '../components/States'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { dateTime, money, normalizePhone, phone } from '../lib/format'
import { formatScore, riskLevel } from '../lib/risk'
import { SORT_OPTIONS, sortOrders, type SortKey } from '../lib/ui/order-sort'
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
  /** New to old, so the list opens on the most recent order. */
  const [sort, setSort] = useState<SortKey>('new-to-old')
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

  /**
   * The order the table renders in.
   *
   * Sorted here rather than re-queried, so changing the sort is instant and
   * cannot cost a round trip. The rows arrive newest-first, which is also the
   * default rule, so the opening view is unchanged for anyone who never opens
   * the menu.
   */
  const shownRows = useMemo(() => sortOrders(filtered, sort), [filtered, sort])

  const counts = useMemo(() => {
    const c = { all: rows.length, pending: 0, accepted: 0, refused: 0 }
    for (const o of rows) {
      const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
      c[s]++
    }
    return c
  }, [rows])

  /** The same four numbers, but for what the filters currently show. */
  const shown = useMemo(() => {
    const c = { all: filtered.length, pending: 0, accepted: 0, refused: 0 }
    for (const o of filtered) {
      const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
      c[s]++
    }
    return c
  }, [filtered])

  /** True when at least one filter is narrowing the list. */
  const narrowed =
    status !== 'all' ||
    term.trim() !== '' ||
    dateFrom !== '' ||
    dateTo !== '' ||
    city.trim() !== '' ||
    product.trim() !== '' ||
    filterStoreId !== ''

  /** One plain sentence naming the filters that are on. */
  const filterSummary = useMemo(() => {
    const parts: string[] = []
    if (dateFrom || dateTo) parts.push(`${dateFrom || 'the start'} → ${dateTo || 'today'}`)
    if (term.trim()) parts.push(`phone ${term.trim()}`)
    if (city.trim()) parts.push(`city “${city.trim()}”`)
    if (product.trim()) parts.push(`product “${product.trim()}”`)
    if (status !== 'all') parts.push(`status ${status}`)
    if (isAdmin && filterStoreId) {
      parts.push(`store ${adminStores.find((s) => s.id === filterStoreId)?.name ?? 'selected'}`)
    }
    return parts.join(' · ')
  }, [dateFrom, dateTo, term, city, product, status, isAdmin, filterStoreId, adminStores])

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
    const out = shownRows.map((o) => ({
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
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-2 px-4 md:h-9"
            onClick={exportCsv}
            disabled={filtered.length === 0}
          >
            <Download className="size-4" /> Export CSV
          </Button>
        }
      />

      {/* What is in the book right now, before any filtering. */}
      {!loading && !loadError && rows.length > 0 && (
        <StatStrip
          items={[
            { label: 'Orders loaded', value: counts.all.toLocaleString('en-PK'), hint: 'Newest 500' },
            { label: 'Pending', value: counts.pending.toLocaleString('en-PK'), hint: 'No outcome recorded yet' },
            { label: 'Accepted', value: counts.accepted.toLocaleString('en-PK'), hint: 'Delivered and kept' },
            { label: 'Refused', value: counts.refused.toLocaleString('en-PK'), hint: 'Returned to origin' },
          ] satisfies StatItem[]}
        />
      )}

      {/* Filters. Date range narrows the query; the rest narrow what is already
          loaded, so the summary line below says exactly what is on. */}
      <div className="rounded-[16px] border border-border bg-card p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex min-w-[150px] flex-col gap-2">
            <span className="text-[13px] font-medium text-muted-foreground">Order date</span>
            <div className="flex items-center gap-2">
              <input
                type="date"
                className="h-11 w-full min-w-[140px] rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground md:h-10 md:text-[15px]"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
              />
              <span className="text-muted-foreground" aria-hidden="true">
                →
              </span>
              <input
                type="date"
                className="h-11 w-full min-w-[140px] rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground md:h-10 md:text-[15px]"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
              />
            </div>
          </div>

          <div className="flex min-w-[150px] flex-1 flex-col gap-2">
            <Label htmlFor="orders-phone" className="text-[13px] font-medium text-muted-foreground">
              Phone
            </Label>
            <input
              id="orders-phone"
              className="h-11 w-full rounded-[10px] border border-input bg-card px-3 font-mono text-[16px] text-foreground placeholder:text-muted-foreground md:h-10 md:text-[15px]"
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="03xx xxxxxxx"
            />
          </div>

          <div className="flex min-w-[150px] flex-1 flex-col gap-2">
            <Label htmlFor="orders-city" className="text-[13px] font-medium text-muted-foreground">
              City
            </Label>
            <input
              id="orders-city"
              className="h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground md:h-10 md:text-[15px]"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Lahore"
            />
          </div>

          {showMoreFilters && (
            <>
              <div className="flex min-w-[150px] flex-1 flex-col gap-2">
                <Label htmlFor="orders-product" className="text-[13px] font-medium text-muted-foreground">
                  Product
                </Label>
                <input
                  id="orders-product"
                  className="h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground md:h-10 md:text-[15px]"
                  type="text"
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  placeholder="Name or category"
                />
              </div>
              {isAdmin && (
                <div className="flex min-w-[150px] flex-col gap-2">
                  <Label htmlFor="orders-store" className="text-[13px] font-medium text-muted-foreground">
                    Store
                  </Label>
                  <select
                    id="orders-store"
                    className="h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground md:h-10 md:text-[15px]"
                    value={filterStoreId}
                    onChange={(e) => setFilterStoreId(e.target.value)}
                  >
                    <option value="">All stores</option>
                    {adminStores.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}

          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 border-dashed px-4 text-primary-text md:h-10"
            aria-expanded={showMoreFilters}
            onClick={() => setShowMoreFilters((v) => !v)}
          >
            {showMoreFilters ? <X className="size-4" /> : <SlidersHorizontal className="size-4" />}
            {showMoreFilters ? 'Fewer filters' : 'More filters'}
          </Button>

          {/* Sorting sits with the filters, because that is where a merchant
              looks when the list is not in the order they want. It reorders
              what is already loaded, so it takes effect immediately. */}
          <div className="flex min-w-[190px] flex-col gap-2">
            <Label htmlFor="orders-sort" className="text-[13px] font-medium text-muted-foreground">
              Sort by
            </Label>
            <select
              id="orders-sort"
              className="h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground md:h-10 md:text-[15px]"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ms-auto flex items-center gap-2">
            <Button type="button" className="h-11 gap-2 px-4 md:h-10" onClick={() => void load()}>
              <Search className="size-4" /> Search
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 px-4 md:h-10"
              onClick={resetFilters}
              disabled={!narrowed}
            >
              <RefreshCw className="size-4" /> Reset
            </Button>
          </div>
        </div>
      </div>

      {/* Status filter, what is showing, and refresh. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-[10px] border border-border bg-card p-1">
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
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12.5px] text-muted-foreground" aria-live="polite">
            Showing {shown.all.toLocaleString('en-PK')} of {counts.all.toLocaleString('en-PK')} loaded
            {narrowed ? ` · ${filterSummary}` : ''}
          </p>
          <Button variant="outline" size="sm" className="h-11 gap-2 px-3 md:h-9" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /> Refresh
          </Button>
        </div>
      </div>

      {/* The table. Wide tables scroll inside this box, never the page. */}
      <div className="overflow-hidden rounded-[16px] border border-border bg-card">
        {loading ? (
          <div className="flex flex-col gap-3 p-6" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} width="100%" height={16} />
            ))}
          </div>
        ) : loadError ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <p className="text-[15px] text-foreground">We could not load your orders.</p>
            <Button variant="outline" className="h-11 px-4 md:h-9" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : shownRows.length === 0 ? (
          <EmptyState
            icon="clipboard"
            title={rows.length === 0 ? 'No orders yet' : 'No orders match'}
            detail={
              rows.length === 0
                ? 'Orders will appear here as they come in.'
                : `Nothing matches ${filterSummary || 'these filters'}. Reset the filters to see all ${counts.all} loaded orders.`
            }
          />
        ) : (
          /* Wide table scrolls inside its own box on phones, never the page. */
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="ps-6">Buyer</TableHead>
                  <TableHead className="text-end">Amount</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden xl:table-cell">City</TableHead>
                  {isAdmin && <TableHead className="hidden lg:table-cell">Store</TableHead>}
                  <TableHead className="pe-6 text-end">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownRows.map((o) => {
                  const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
                  const busy = working === o.id
                  return (
                    <TableRow
                      key={o.id}
                      // Keyboard marking: focus a row and press A (accept) or
                      // R (refuse), as this screen has always supported.
                      tabIndex={s === 'pending' ? 0 : undefined}
                      onKeyDown={
                        s === 'pending'
                          ? (e) => {
                              const k = e.key.toLowerCase()
                              if (k !== 'a' && k !== 'r') return
                              e.preventDefault()
                              void mark(o, k === 'a' ? 'accepted' : 'refused')
                            }
                          : undefined
                      }
                    >
                      <TableCell className="ps-6">
                        <Link
                          to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}
                          className="font-mono text-[13px] font-medium text-primary-text hover:underline"
                        >
                          {phone(o.buyer_phone)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(o.price)}
                        {o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}
                      </TableCell>
                      <TableCell>
                        <VerdictBadge riskScore={o.buyers?.risk_score} totalOrders={o.buyers?.total_orders} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {dateTime(o.ordered_at)}
                      </TableCell>
                      <TableCell className="max-w-56 truncate">
                        {o.product_name || o.product_category || 'Untitled product'}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground xl:table-cell">{o.city || '—'}</TableCell>
                      {isAdmin && (
                        <TableCell className="hidden text-muted-foreground lg:table-cell">
                          {o.stores?.name ?? '—'}
                        </TableCell>
                      )}
                      <TableCell className="pe-6">
                        {s !== 'pending' ? (
                          <span className="block text-end text-[13px] text-muted-foreground">—</span>
                        ) : (
                          <span className="flex flex-wrap justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-11 gap-1.5 border-risk-safe/40 px-3 text-risk-safe-strong hover:bg-risk-safe-soft md:h-9"
                              disabled={busy}
                              onClick={() => void mark(o, 'accepted')}
                            >
                              {busy ? <RefreshCw className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{' '}
                              Accept
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-11 gap-1.5 border-risk-high/40 px-3 text-risk-high-strong hover:bg-risk-high-soft md:h-9"
                              disabled={busy}
                              onClick={() => void mark(o, 'refused')}
                            >
                              {busy ? <RefreshCw className="size-3.5 animate-spin" /> : <X className="size-3.5" />}{' '}
                              Refuse
                            </Button>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </PageShell>
  )
}
