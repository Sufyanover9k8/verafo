import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Check,
  Download,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { StatStrip, type StatItem } from '../components/app/stat-strip'
import { Skeleton } from '../components/primitives/Skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { VerdictBadge } from '../components/app/verdict-badge'
import {
  RISK_FILTER_SUMMARY,
  RiskFilter,
  orderMatchesRisk,
  type RiskFilterValue,
} from '../components/app/risk-filter'
import { StatusBadge } from '../components/app/status-badge'
import { EmptyState, NeedsSetup } from '../components/States'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { dateTime, money, phone } from '../lib/format'
import { orderUnits } from '../lib/ui/money'
import { formatScore, riskLevel } from '../lib/risk'
import { SORT_OPTIONS, sortOrders, type SortKey } from '../lib/ui/order-sort'
import { countHiddenOrders, setOrdersHidden, softDeleteReady } from '../lib/ui/order-visibility'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { OrderRow, OutcomeStatus } from '../lib/types'

type StatusFilter = 'all' | 'pending' | 'accepted' | 'refused'

/**
 * The subscriber number of a phone, for matching.
 *
 * Digits only, reduced to the last ten — the same rule the database uses in
 * `verafo_phone_key`. That is what makes "+92 300 1234028", "03001234028" and
 * "3001234028" one value, so a search cannot miss a row because of the way the
 * number happened to be stored.
 */
function phoneKey(v: string | null | undefined): string {
  const digits = String(v ?? '').replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

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
  const navigate = useNavigate()
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
  /** Which risk band the list is narrowed to. `all` is the default view. */
  const [risk, setRisk] = useState<RiskFilterValue>('all')
  const [filterStoreId, setFilterStoreId] = useState('')
  const [showMoreFilters, setShowMoreFilters] = useState(false)
  /**
   * On a phone the filter panel starts collapsed. Stacked, its fields filled the
   * entire first screen, so a merchant opening Orders saw filters instead of
   * orders. Desktop keeps it open — there is room, and it belongs in that row.
   */
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [working, setWorking] = useState<string | null>(null)

  /**
   * Hiding, not deleting.
   *
   * `canHide` is false until the database says the column exists, so the whole
   * feature disappears politely on a database where the migration has not run —
   * rather than every order query failing on a missing column.
   */
  const [canHide, setCanHide] = useState(false)
  const [hiddenView, setHiddenView] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmHide, setConfirmHide] = useState<Row[] | null>(null)
  const [hiding, setHiding] = useState(false)
  /** Delete orders is a mode: the tick boxes only exist while it is on. */
  const [selectMode, setSelectMode] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setLoadError(false)
    const allowHide = await softDeleteReady()
    setCanHide(allowHide)

    let query = supabase
      .from('orders')
      .select(
        '*, stores(name), buyers(risk_score, total_orders, total_accepted, total_refused), outcomes(status, resolved_at, refusal_reason)',
      )
    // Hidden orders are out of the product everywhere; the Hidden view is the
    // one place they come back, so a mistake is always recoverable.
    if (allowHide) {
      query = hiddenView ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null)
    }
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
    if (allowHide) setHiddenCount(await countHiddenOrders())
    setSelected(new Set())
    setLoading(false)
  }, [toast, store, scopeStoreIds, isAdmin, filterStoreId, dateFrom, dateTo, hiddenView])

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
    setRisk('all')
  }

  const filtered = useMemo(() => {
    /*
     * PHONE MATCHING IS BY SUBSCRIBER NUMBER, NOT BY STRING.
     *
     * The stored value is whatever spelling the order arrived with —
     * "+923001234028" from an import, "03001234028" from a form, "3001234028"
     * from a spreadsheet. Comparing the typed digits against the stored digits
     * as strings therefore missed every row whose spelling differed, which is
     * why searching a number that was plainly on screen returned nothing.
     *
     * Both sides are reduced to the last ten digits — the same key the database
     * uses (verafo_phone_key) — so any spelling of the same number matches, and
     * a partial like "1234028" still finds it.
     */
    const q = phoneKey(term)
    const c = city.trim().toLowerCase()
    const p = product.trim().toLowerCase()
    // City and product may be typed with stray spacing; trim before comparing.
    return rows.filter((o) => {
      const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
      if (status !== 'all' && s !== status) return false
      // Same band the row's badge shows, so the filter and the pill never disagree.
      if (!orderMatchesRisk(o.buyers?.risk_score, o.buyers?.total_orders, risk)) return false
      if (q && !phoneKey(o.buyer_phone).includes(q)) return false
      if (c && !(o.city ?? '').trim().toLowerCase().includes(c)) return false
      // Stored under its own heading so the address is searchable too.
      if (
        p &&
        !`${o.product_name ?? ''} ${o.product_category ?? ''} ${o.stores?.name ?? ''} ${o.address ?? ''}`
          .toLowerCase()
          .includes(p)
      ) {
        return false
      }
      return true
    })
  }, [rows, status, term, city, product, risk])

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
    filterStoreId !== '' ||
    risk !== 'all'

  /** One plain sentence naming the filters that are on. */
  const filterSummary = useMemo(() => {
    const parts: string[] = []
    if (dateFrom || dateTo) parts.push(`${dateFrom || 'the start'} → ${dateTo || 'today'}`)
    if (term.trim()) parts.push(`phone ${term.trim()}`)
    if (city.trim()) parts.push(`city “${city.trim()}”`)
    if (product.trim()) parts.push(`product “${product.trim()}”`)
    if (risk !== 'all') parts.push(RISK_FILTER_SUMMARY[risk])
    if (status !== 'all') parts.push(`status ${status}`)
    if (isAdmin && filterStoreId) {
      parts.push(`store ${adminStores.find((s) => s.id === filterStoreId)?.name ?? 'selected'}`)
    }
    return parts.join(' · ')
  }, [dateFrom, dateTo, term, city, product, status, isAdmin, filterStoreId, adminStores, risk])

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

  /* ── Hiding (never deleting) ─────────────────────────────── */

  /** One place for both directions, so the messaging cannot drift from the act. */
  async function applyHidden(ids: string[], hidden: boolean) {
    if (!supabase || hiding || ids.length === 0) return
    setHiding(true)
    const res = await setOrdersHidden(ids, hidden)
    setHiding(false)
    if (res.error) {
      toast.push({ kind: 'error', title: hidden ? 'Could not hide' : 'Could not restore', detail: res.error })
      return
    }
    setConfirmHide(null)
    setSelected(new Set())
    // A finished delete leaves the mode: the tick boxes are not part of the page.
    if (hidden) setSelectMode(false)
    toast.push({
      kind: 'success',
      title: hidden
        ? `${res.changed} order${res.changed === 1 ? '' : 's'} deleted`
        : `${res.changed} order${res.changed === 1 ? '' : 's'} restored`,
      detail: hidden ? 'Removed from this list.' : 'Back in the order book.',
    })
    // Restoring the last hidden order would leave an empty screen behind, so step
    // back to the list the user was on.
    if (!hidden && hiddenView && hiddenCount <= ids.length) setHiddenView(false)
    void load()
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === shownRows.length ? new Set() : new Set(shownRows.map((o) => o.id)),
    )
  }

  const allShownSelected = shownRows.length > 0 && selected.size === shownRows.length

  function exportCsv() {    const out = shownRows.map((o) => ({
      buyer_phone: o.buyer_phone,
      store: o.stores?.name ?? '',
      product: o.product_name || o.product_category || '',
      city: o.city ?? '',
      // `price` stores the order-line total, so do not multiply by quantity again.
      total: o.price ?? 0,
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
          <div className="flex items-center gap-2">
            {/* The entry point. Nothing tickable exists until this is pressed. */}
            {canHide && !hiddenView && (
              <Button
                variant={selectMode ? 'default' : 'outline'}
                size="sm"
                className="h-11 gap-2 px-4 md:h-9"
                aria-pressed={selectMode}
                onClick={() => {
                  setSelectMode((v) => !v)
                  setSelected(new Set())
                }}
              >
                {selectMode ? <X className="size-4" /> : <Trash2 className="size-4" />}
                {selectMode ? 'Cancel' : 'Delete orders'}
              </Button>
            )}
            {/* Only offered when there is something in it, so nobody lands on an
                empty screen wondering what it is. */}
            {canHide && (hiddenView || hiddenCount > 0) && (
              <Button
                variant={hiddenView ? 'default' : 'outline'}
                size="sm"
                className="h-11 gap-2 px-4 md:h-9"
                aria-pressed={hiddenView}
                onClick={() => setHiddenView((v) => !v)}
              >
                {hiddenView ? <RotateCcw className="size-4" /> : <EyeOff className="size-4" />}
                {hiddenView ? 'Back to orders' : `Hidden (${hiddenCount})`}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-11 gap-2 px-4 md:h-9"
              onClick={exportCsv}
              disabled={filtered.length === 0}
            >
              <Download className="size-4" /> Export CSV
            </Button>
          </div>
        }
      />

      {/* Shown only when the database is missing the migration. No explanation
          of the storage model — just what to run. */}
      {isAdmin && !canHide && !loading && (
        <div className="flex items-start gap-2.5 rounded-[var(--r-card)] border border-risk-watch/40 bg-risk-watch-soft p-4 text-[12.5px] leading-relaxed text-risk-watch-strong">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Run{' '}
            <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[11.5px]">
              supabase/order-soft-delete.sql
            </code>{' '}
            in the Supabase SQL editor, then press Refresh.
          </span>
        </div>
      )}

      {/* What is in the book right now, before any filtering. Hidden orders are
          not part of the book, so the strip would only confuse in that view. */}
      {!hiddenView && !loading && !loadError && rows.length > 0 && (
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
          loaded, so the summary line below says exactly what is on.
          Collapsed on phones — see mobileFiltersOpen. The toggle lives below so
          it stays reachable whether the panel is open or shut. */}
      <div
        className={cn(
          'rounded-[var(--r-card)] border border-border bg-card p-4 sm:p-5',
          !mobileFiltersOpen && 'max-sm:hidden',
        )}
      >
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

          {/* Not tucked behind "More filters": narrowing the book to high-risk
              orders is a primary way to read this screen. */}
          <RiskFilter id="orders-risk" value={risk} onChange={setRisk} />

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

      {/* Status filter, what is showing, and refresh.
          Pinned: with 140 rows loaded, the tab you are on and the count you are
          reading used to scroll away, so changing either meant going back to the
          top of the page. `top-14` is the top bar's height. */}
      <div className="sticky top-14 z-30 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* Mobile-only: open or close the filter panel above. The label says
              how many filters are on, so a collapsed panel never hides the fact
              that the list is being narrowed. */}
          <Button
            type="button"
            variant="outline"
            className="h-11 gap-2 px-3 sm:hidden"
            aria-expanded={mobileFiltersOpen}
            onClick={() => setMobileFiltersOpen((v) => !v)}
          >
            <SlidersHorizontal className="size-4" />
            {mobileFiltersOpen ? 'Hide filters' : narrowed ? 'Filters on' : 'Filters'}
          </Button>
          {/* One row on a phone: the four counters scroll sideways rather than
              dropping "Refused" onto a second line by itself. `min-w-0` is what
              lets the bar shrink below its content and scroll — without it the
              flex item's min-content width wins and the page clips it. */}
          <div className="inline-flex min-w-0 max-w-full flex-nowrap gap-1 overflow-x-auto rounded-[10px] border border-border bg-card p-1 [scrollbar-width:none] sm:flex-wrap">
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

      {/* Selection bar: the second half of Delete orders. It is on screen the
          whole time the mode is on, so the way out is always visible. */}
      {canHide && (selectMode || hiddenView) && (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--r-card)] border border-border bg-muted px-4 py-3">
          <p className="text-[13px] font-medium text-foreground" aria-live="polite">
            {selected.size > 0
              ? `${selected.size} selected`
              : hiddenView
                ? 'Select the orders you want to restore'
                : 'Select the orders you want to delete'}
          </p>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            {hiddenView ? (
              <Button
                className="h-11 gap-2 px-4 md:h-9"
                disabled={hiding || selected.size === 0}
                onClick={() => void applyHidden([...selected], false)}
              >
                {hiding ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                Restore
              </Button>
            ) : (
              <Button
                variant="destructive"
                className="h-11 gap-2 px-4 md:h-9"
                disabled={hiding || selected.size === 0}
                onClick={() => setConfirmHide(rows.filter((r) => selected.has(r.id)))}
              >
                {hiding ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                Delete{selected.size > 0 ? ` ${selected.size}` : ''}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* The table. Wide tables scroll inside this box, never the page. */}
      <div className="overflow-hidden rounded-[var(--r-card)] border border-border bg-card">
        {loading ? (
          <div className="flex flex-col gap-3 p-5" aria-busy="true">
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
          /* Wide table scrolls inside its own box on phones, never the page.
             From `lg` the box also caps its height, so the sticky header stays
             with you while a 140-row book scrolls past. */
          <div className="w-full overflow-x-auto">
            <Table containerClassName="lg:max-h-[72vh] lg:overflow-y-auto">
              <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:border-border [&_th]:bg-card">
                <TableRow className="hover:bg-transparent">
                  {(selectMode || hiddenView) && (
                    <TableHead className="w-10 ps-6">
                      <Checkbox
                        className="rounded-[4px]"
                        checked={allShownSelected}
                        onCheckedChange={toggleAll}
                        aria-label={allShownSelected ? 'Deselect every order' : 'Select every order shown'}
                      />
                    </TableHead>
                  )}
                  <TableHead className={selectMode || hiddenView ? undefined : 'ps-6'}>Buyer</TableHead>
                  <TableHead className="text-end">Amount</TableHead>
                  <TableHead className="text-end">Items</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Date</TableHead>
                  <TableHead>Product</TableHead>
                  {/* City and Store are the first to go: at 1440 the remaining
                      columns fit, so the action buttons are never the thing that
                      gets clipped. The action column stays pinned, so Accept and
                      Refuse are reachable even when the table does scroll. */}
                  <TableHead className="hidden 2xl:table-cell">City</TableHead>
                  {isAdmin && <TableHead className="hidden 2xl:table-cell">Store</TableHead>}
                  {/* Pinned from `lg` only: on a phone the action group is
                      wider than the screen, so pinning it would cover the data. */}
                  <TableHead className="pe-6 text-end lg:sticky lg:end-0 lg:z-20 lg:border-s lg:border-border lg:bg-card">
                    Action
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shownRows.map((o) => {
                  const s = (o.outcomes?.status ?? 'pending') as OutcomeStatus
                  const busy = working === o.id
                  const units = orderUnits(o.quantity)
                  /* A row is a thing you can open. While delete mode is on the
                     click belongs to the tick boxes, so it stays inert there. */
                  const canOpen = !selectMode && !hiddenView
                  const openBuyer = () => navigate(`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`)
                  return (
                    <TableRow
                      key={o.id}
                      className={cn(
                        'group',
                        canOpen && 'cursor-pointer',
                        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--teal)]',
                      )}
                      onClick={canOpen ? openBuyer : undefined}
                      // Keyboard marking: focus a row and press A (accept) or
                      // R (refuse), as this screen has always supported.
                      tabIndex={s === 'pending' ? 0 : undefined}
                      onKeyDown={
                        s === 'pending'
                          ? (e) => {
                              const k = e.key.toLowerCase()
                              if (k === 'enter' && canOpen) {
                                e.preventDefault()
                                openBuyer()
                                return
                              }
                              if (k !== 'a' && k !== 'r') return
                              e.preventDefault()
                              void mark(o, k === 'a' ? 'accepted' : 'refused')
                            }
                          : undefined
                      }
                    >
                      <TableCell className={selectMode || hiddenView ? undefined : 'ps-6'}>
                        {(selectMode || hiddenView) && (
                          <Checkbox
                            className="me-3 rounded-[4px] align-middle"
                            checked={selected.has(o.id)}
                            onCheckedChange={() => toggleSelected(o.id)}
                            aria-label={`Select order ${phone(o.buyer_phone)}`}
                          />
                        )}
                        <Link
                          to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-[13px] font-medium text-primary-text hover:underline"
                          title={phone(o.buyer_phone)}
                        >
                          {phone(o.buyer_phone)}
                        </Link>
                      </TableCell>
                      <TableCell
                        className="text-end tabular-nums"
                        // The working is one hover away: the unit price stays
                        // legible without being mistaken for the total. The
                        // Items column beside this one carries the count.
                        title={
                          (o.quantity ?? 1) > 1 && o.price != null
                            ? `${money((o.price ?? 0) / (o.quantity ?? 1))} each x ${o.quantity}`
                            : undefined
                        }
                      >
                        {money(o.price)}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{o.quantity ?? 1}</TableCell>
                      <TableCell>
                        <VerdictBadge riskScore={o.buyers?.risk_score} totalOrders={o.buyers?.total_orders} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={s} />
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {dateTime(o.ordered_at)}
                      </TableCell>
                      <TableCell className="max-w-56">
                        {/* The unit count belongs to the product, not to the
                            money: "2 units" here, and the Amount column above
                            shows only what the courier collects. */}
                        <span className="flex items-baseline gap-1.5">
                          <span className="truncate" title={o.product_name || o.product_category || 'Untitled product'}>
                            {o.product_name || o.product_category || 'Untitled product'}
                          </span>
                          {units && (
                            <span className="shrink-0 text-[12px] text-muted-foreground">{units} units</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground 2xl:table-cell">{o.city || '—'}</TableCell>
                      {isAdmin && (
                        <TableCell className="hidden text-muted-foreground 2xl:table-cell">
                          {o.stores?.name ?? '—'}
                        </TableCell>
                      )}
                      <TableCell
                        className="pe-6 lg:sticky lg:end-0 lg:z-[5] lg:border-s lg:border-border lg:bg-card lg:group-hover:bg-muted/50"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="flex flex-nowrap items-center justify-end gap-2">
                          {hiddenView ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-11 gap-1.5 px-3 md:h-9"
                              disabled={hiding}
                              onClick={() => void applyHidden([o.id], false)}
                            >
                              <RotateCcw className="size-3.5" /> Restore
                            </Button>
                          ) : (
                            <>
                              {canHide && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="size-11 text-muted-foreground hover:bg-risk-high-soft hover:text-risk-high-strong md:size-9"
                                  title="Delete order"
                                  aria-label={`Delete order ${phone(o.buyer_phone)}`}
                                  disabled={hiding}
                                  onClick={() => setConfirmHide([o])}
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              )}
                              {s === 'pending' ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-11 gap-1.5 border-risk-safe/40 px-3 text-risk-safe-strong hover:bg-risk-safe-soft md:h-9"
                                    disabled={busy}
                                    onClick={() => void mark(o, 'accepted')}
                                  >
                                    {busy ? (
                                      <RefreshCw className="size-3.5 animate-spin" />
                                    ) : (
                                      <Check className="size-3.5" />
                                    )}{' '}
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
                                    {busy ? (
                                      <RefreshCw className="size-3.5 animate-spin" />
                                    ) : (
                                      <X className="size-3.5" />
                                    )}{' '}
                                    Refuse
                                  </Button>
                                </>
                              ) : (
                                !canHide && (
                                  <span className="text-[13px] text-muted-foreground">—</span>
                                )
                              )}
                            </>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Confirmation, nothing more. */}
      <Dialog
        open={confirmHide !== null && confirmHide.length > 0}
        onOpenChange={(open) => !open && setConfirmHide(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Delete {confirmHide?.length === 1 ? 'this order' : `${confirmHide?.length ?? 0} orders`}?
            </DialogTitle>
            <DialogDescription>
              {confirmHide?.length === 1 ? 'It' : 'They'} will be removed from Verafo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmHide(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="gap-2"
              disabled={hiding}
              onClick={() => void applyHidden((confirmHide ?? []).map((r) => r.id), true)}
            >
              {hiding ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
