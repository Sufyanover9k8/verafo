import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, RefreshCw, X } from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { StatusBadge } from '../components/app/status-badge'
import { Skeleton } from '../components/primitives/Skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, NeedsSetup } from '../components/States'
import { dateTime, money, phone } from '../lib/format'
import { formatScore, riskLevel } from '../lib/risk'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { OrderRow, OutcomeStatus } from '../lib/types'

type Tab = 'pending' | 'resolved'

/** How long the row stays faded after a mark, so the change is visible. */
const EXIT_MS = 260

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
    let query = supabase.from('orders').select('*, stores(name), outcomes(status, resolved_at, refusal_reason)')
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

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'pending', label: 'Pending', count: pending.length },
    { key: 'resolved', label: 'Resolved', count: resolved.length },
  ]

  const refusalRate = (() => {
    const accepted = orders.filter((o) => o.outcomes?.status === 'accepted').length
    const refused = orders.filter((o) => o.outcomes?.status === 'refused').length
    const resolvedCount = accepted + refused
    return resolvedCount > 0 ? `${Math.round((refused / resolvedCount) * 100)}%` : '—'
  })()

  return (
    <PageShell>
      <PageHeader
        title="Outcomes"
        description={
          store
            ? `Recording outcomes for ${store.name} — every outcome instantly re-scores that buyer.`
            : 'After delivery, record accepted or refused. Every outcome instantly re-scores that buyer.'
        }
        actions={
          <Button variant="outline" size="sm" className="h-11 gap-2 px-3 md:h-9" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /> Refresh
          </Button>
        }
      />

      {/* What is waiting, and how the book has resolved so far. */}
      {!loading && !loadError && orders.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-[16px] border border-border bg-card p-5">
            <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Awaiting a verdict</p>
            <p className="mt-1.5 text-[26px] leading-none font-semibold tabular-nums text-foreground">{pending.length}</p>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">No outcome recorded yet</p>
          </div>
          <div className="rounded-[16px] border border-border bg-card p-5">
            <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Refusal rate</p>
            <p className="mt-1.5 text-[26px] leading-none font-semibold tabular-nums text-foreground">{refusalRate}</p>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">Of the orders you have resolved</p>
          </div>
          <div className="rounded-[16px] border border-border bg-card p-5">
            <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Loaded</p>
            <p className="mt-1.5 text-[26px] leading-none font-semibold tabular-nums text-foreground">{orders.length}</p>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">Newest 200 orders</p>
          </div>
        </div>
      )}

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

      <Card className="gap-0 overflow-hidden p-0">
        {loading ? (
          <div className="flex flex-col gap-3 p-6" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
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
          /* Wide table scrolls inside its own box on phones, never the page. */
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="ps-6">Buyer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden md:table-cell">Store</TableHead>
                  <TableHead className="text-end">Amount</TableHead>
                  <TableHead className="hidden lg:table-cell">Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="pe-6 text-end">Mark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((o) => {
                  const status = (o.outcomes?.status ?? 'pending') as OutcomeStatus
                  const busy = working === o.id
                  return (
                    <TableRow
                      key={o.id}
                      // Keyboard marking: focus a row and press A (accept) or
                      // R (refuse), as this screen has always supported.
                      tabIndex={status === 'pending' ? 0 : undefined}
                      onKeyDown={
                        status === 'pending'
                          ? (e) => {
                              const k = e.key.toLowerCase()
                              if (k !== 'a' && k !== 'r') return
                              e.preventDefault()
                              void mark(o, k === 'a' ? 'accepted' : 'refused')
                            }
                          : undefined
                      }
                      className={leaving[o.id] ? 'opacity-40 transition-opacity' : 'transition-opacity'}
                    >
                      <TableCell className="ps-6">
                        <Link
                          to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}
                          className="font-mono text-[13px] font-medium text-primary-text hover:underline"
                        >
                          {phone(o.buyer_phone)}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-56 truncate">
                        {o.product_name || o.product_category || 'Untitled product'}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {o.stores?.name ?? 'Unknown store'}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {money(o.price)}
                        {o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        {dateTime(o.ordered_at)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={status} />
                      </TableCell>
                      <TableCell className="pe-6">
                        {status !== 'pending' ? (
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
                              aria-label={`Mark ${phone(o.buyer_phone)} as accepted`}
                            >
                              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                              Accept
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-11 gap-1.5 border-risk-high/40 px-3 text-risk-high-strong hover:bg-risk-high-soft md:h-9"
                              disabled={busy}
                              onClick={() => void mark(o, 'refused')}
                              aria-label={`Mark ${phone(o.buyer_phone)} as refused`}
                            >
                              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
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
      </Card>
    </PageShell>
  )
}
