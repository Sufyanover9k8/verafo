import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ListChecks, Loader2, RefreshCw, Undo2, X } from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { VerdictBadge, bandEvidence } from '../components/app/verdict-badge'
import { Skeleton } from '../components/primitives/Skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { EmptyState, NeedsSetup } from '../components/States'
import { dateTime, money, phone } from '../lib/format'
import { formatScore } from '../lib/risk'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { OrderRow, OutcomeStatus } from '../lib/types'

type Tab = 'pending' | 'resolved'

/** The order rows here carry the buyer's score, so each row can show its band. */
interface Row extends OrderRow {
  buyers?: { risk_score: number | null; total_orders: number | null } | null
}

/** How long the row stays faded after a mark, so the change is visible. */
const EXIT_MS = 260

export function Outcomes() {
  const toast = useToast()
  const { store } = useStoreScope()
  const [orders, setOrders] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState<Tab>('pending')
  const [working, setWorking] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<Record<string, boolean>>({})
  /** Rows ticked for a bulk accept/refuse. */
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /**
   * Checkboxes are hidden until asked for. A tick box on every row made the
   * list read as a form; the everyday job is scanning outcomes, not selecting.
   */
  const [selectMode, setSelectMode] = useState(false)
  /**
   * The last outcome change, so a mis-click can be taken back.
   *
   * Editing an outcome was already possible on the Resolved tab, but a wrong
   * mark on a long pending list is easy to make and easy to miss — so the most
   * recent change offers an immediate undo that restores the exact prior state,
   * including "there was no outcome at all", which means deleting the row rather
   * than writing "pending".
   */
  const [lastAction, setLastAction] = useState<{
    orderId: string
    buyerPhone: string
    status: 'accepted' | 'refused'
    prev: OutcomeStatus | null
  } | null>(null)
  const timers = useRef<number[]>([])

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setLoadError(false)
    // The buyer's score comes along with the order so each row can show its
    // band — the merchant should not have to open Buyer Lookup to judge a row.
    let query = supabase
      .from('orders')
      .select('*, stores(name), buyers(risk_score, total_orders), outcomes(status, resolved_at, refusal_reason)')
    if (store) query = query.eq('store_id', store.id)
    const { data, error } = await query.order('ordered_at', { ascending: false }).limit(200)
    if (error) {
      setLoadError(true)
      toast.push({ kind: 'error', title: 'Could not load orders', detail: error.message })
    } else {
      setOrders((data ?? []) as Row[])
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

  /**
   * Write one outcome. The single path every action goes through, so a manual
   * mark, a re-mark from the Resolved tab, a bulk run and an undo all persist
   * identically — an upsert on `order_id`, which is what makes an EDIT land in
   * the database rather than adding a second row.
   */
  async function writeOutcome(orderId: string, status: OutcomeStatus) {
    if (!supabase) throw new Error('Supabase is not configured')
    if (status === 'pending') {
      // "No outcome" is the ABSENCE of a row, so undoing back to pending must
      // delete it. Upserting status='pending' would leave a row that the rest of
      // the app treats as resolved-but-unknown.
      const { error } = await supabase.from('outcomes').delete().eq('order_id', orderId)
      if (error) throw error
      return
    }
    const { error } = await supabase
      .from('outcomes')
      .upsert(
        { order_id: orderId, status, resolved_at: new Date().toISOString() },
        { onConflict: 'order_id' },
      )
    if (error) throw error
  }

  async function mark(order: OrderRow, status: 'accepted' | 'refused') {
    if (!supabase || working) return
    setWorking(order.id)
    const prev = (order.outcomes?.status ?? null) as OutcomeStatus | null
    try {
      await writeOutcome(order.id, status)

      const { data: buyer, error: bErr } = await supabase
        .from('buyers')
        .select('risk_score, total_orders')
        .eq('phone', order.buyer_phone)
        .maybeSingle()
      if (bErr) throw bErr

      setLeaving((prev) => ({ ...prev, [order.id]: true }))
      setLastAction({ orderId: order.id, buyerPhone: order.buyer_phone, status, prev })
      const score = buyer?.risk_score ?? 0.5
      // This order has just resolved, so count it before classifying. The
      // vocabulary must match the row badge exactly, or the toast and the
      // badge that re-renders under it would name two different bands.
      const totalOrdersAfter = Number(buyer?.total_orders ?? 0) + 1
      const { band } = bandEvidence(score, totalOrdersAfter)
      toast.push({
        kind: 'success',
        title: status === 'accepted' ? 'Marked as accepted' : 'Marked as refused',
        detail: `${phone(order.buyer_phone)} — new risk score ${formatScore(score)} (${band})`,
      })
      timers.current.push(window.setTimeout(() => void load(), EXIT_MS))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({ kind: 'error', title: 'Could not update outcome', detail: message })
    } finally {
      setWorking(null)
    }
  }

  /** Take back the most recent change, restoring exactly what was there before. */
  async function undoLast() {
    if (!lastAction || working) return
    const action = lastAction
    setWorking(action.orderId)
    try {
      await writeOutcome(action.orderId, action.prev ?? 'pending')
      toast.push({
        kind: 'success',
        title: 'Outcome undone',
        detail: `${phone(action.buyerPhone)} — ${
          action.prev ? `back to ${action.prev}` : 'back to awaiting a verdict'
        }`,
      })
      setLastAction(null)
      setLeaving({})
      void load()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({ kind: 'error', title: 'Could not undo', detail: message })
    } finally {
      setWorking(null)
    }
  }

  /**
   * Apply one outcome to every selected order.
   *
   * Sequential, not parallel: each write fires the database trigger that
   * recomputes that buyer's score, and firing a hundred at once is how a bulk
   * action becomes a rate-limited failure halfway through. Progress is reported
   * on the button, and a partial failure is named rather than swallowed.
   */
  async function markSelected(status: 'accepted' | 'refused') {
    if (!supabase || working || selected.size === 0) return
    const rows = orders.filter((o) => selected.has(o.id))
    setWorking('__bulk__')
    let done = 0
    const failed: string[] = []
    for (const row of rows) {
      try {
        await writeOutcome(row.id, status)
        done++
      } catch {
        failed.push(phone(row.buyer_phone))
      }
    }
    setWorking(null)
    setSelected(new Set())
    setSelectMode(false)
    setLastAction(null)

    if (failed.length === 0) {
      toast.push({
        kind: 'success',
        title: `${done} order${done === 1 ? '' : 's'} marked ${status}`,
        detail: 'Each buyer was re-scored.',
      })
    } else {
      toast.push({
        kind: 'error',
        title: `${done} marked, ${failed.length} failed`,
        detail: `Could not update ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`,
      })
    }
    void load()
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

      {/* What is waiting, and how the book has resolved so far.
          Three across at every width: stacked on a phone these took the whole
          first screen and the list the merchant came for began below the fold. */}
      {!loading && !loadError && orders.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
          <div className="min-w-0 rounded-[var(--r-card)] border border-border bg-card p-3 sm:p-5">
            <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase sm:text-[11px] sm:tracking-[0.14em]">
              Awaiting a verdict
            </p>
            <p className="mt-1.5 text-[21px] leading-none font-semibold tabular-nums text-foreground sm:text-[26px]">
              {pending.length}
            </p>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground sm:text-[12.5px]">No outcome recorded yet</p>
          </div>
          <div className="min-w-0 rounded-[var(--r-card)] border border-border bg-card p-3 sm:p-5">
            <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase sm:text-[11px] sm:tracking-[0.14em]">
              Refusal rate
            </p>
            <p className="mt-1.5 text-[21px] leading-none font-semibold tabular-nums text-foreground sm:text-[26px]">
              {refusalRate}
            </p>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground sm:text-[12.5px]">Of the orders you have resolved</p>
          </div>
          <div className="min-w-0 rounded-[var(--r-card)] border border-border bg-card p-3 sm:p-5">
            <p className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase sm:text-[11px] sm:tracking-[0.14em]">
              Loaded
            </p>
            <p className="mt-1.5 text-[21px] leading-none font-semibold tabular-nums text-foreground sm:text-[26px]">
              {orders.length}
            </p>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground sm:text-[12.5px]">Newest 200 orders</p>
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

      {/* Bulk entry point. The checkboxes themselves only exist in select mode,
          so the default screen stays a plain list. */}
      {tab === 'pending' && pending.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-3 text-[12.5px]">
          {selectMode && (
            <button
              type="button"
              className="font-medium text-primary-text hover:underline"
              onClick={() =>
                setSelected((s) =>
                  s.size === pending.length ? new Set() : new Set(pending.map((o) => o.id)),
                )
              }
            >
              {selected.size === pending.length ? 'Clear selection' : `Select all ${pending.length}`}
            </button>
          )}
          <Button
            type="button"
            variant={selectMode ? 'default' : 'outline'}
            size="sm"
            className="h-9 gap-1.5 px-3"
            onClick={() => {
              setSelectMode((on) => {
                if (on) setSelected(new Set())
                return !on
              })
            }}
          >
            <ListChecks className="size-3.5" />
            {selectMode ? 'Done' : 'Bulk select'}
          </Button>
        </div>
      )}

      {/* Undo for the most recent change. Stays until another action replaces
          it, so a wrong click is recoverable a few seconds later rather than
          only via the Resolved tab. */}
      {lastAction && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--r-card)] border border-risk-watch/40 bg-risk-watch-soft px-4 py-3">
          <span className="text-[13px] text-foreground">
            Marked <strong className="font-semibold">{phone(lastAction.buyerPhone)}</strong> as{' '}
            <strong className="font-semibold">{lastAction.status}</strong>
            {lastAction.prev ? ` (was ${lastAction.prev})` : ''}.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 px-3"
            disabled={Boolean(working)}
            onClick={() => void undoLast()}
          >
            <Undo2 className="size-3.5" /> Undo
          </Button>
        </div>
      )}

      {/* Bulk bar. Only appears once something is ticked, so the default screen
          stays as quiet as it was. */}
      {selectMode && tab === 'pending' && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--r-card)] border border-border bg-card px-4 py-3">
          <span className="text-[13px] font-medium text-foreground">
            {selected.size} of {pending.length} selected
          </span>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 gap-1.5 border-risk-safe/50 bg-risk-safe-badge-bg px-3 text-risk-safe-badge hover:bg-risk-safe-badge-hover hover:text-risk-safe-badge md:h-9"
              disabled={Boolean(working)}
              onClick={() => void markSelected('accepted')}
            >
              {working === '__bulk__' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Accept all
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 gap-1.5 border-risk-high/50 bg-risk-high-badge-bg px-3 text-risk-high-badge hover:bg-risk-high-badge-hover hover:text-risk-high-badge md:h-9"
              disabled={Boolean(working)}
              onClick={() => void markSelected('refused')}
            >
              {working === '__bulk__' ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <X className="size-3.5" />
              )}
              Refuse all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 px-3 md:h-9"
              disabled={Boolean(working)}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

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
          /*
           * A row list, not a table. As a seven-column table the Mark column sat
           * last, so on anything narrower than a wide desktop the Accept /
           * Refuse buttons were the first thing pushed out of view and the row
           * had to be dragged sideways before it could be resolved.
           *
           * Here the facts wrap and the action stays pinned to the right edge at
           * every width, so an outcome can always be marked where it is read.
           */
          <ul className="m-0 list-none divide-y divide-border p-0">
            {visible.map((o) => {
              const status = (o.outcomes?.status ?? 'pending') as OutcomeStatus
              const busy = working === o.id
              const facts = [
                o.product_name || o.product_category || 'Untitled product',
                o.stores?.name ?? 'Unknown store',
                `${money(o.price)}${o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}`,
                dateTime(o.ordered_at),
              ]
              return (
                <li
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
                  className={cn(
                    'flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 transition-opacity sm:px-6',
                    leaving[o.id] && 'opacity-40',
                  )}
                >
                  <div className="flex items-start gap-3">
                    {selectMode && status === 'pending' && (
                      <input
                        type="checkbox"
                        className="mt-1.5 size-4 shrink-0 accent-[var(--teal)]"
                        checked={selected.has(o.id)}
                        onChange={() =>
                          setSelected((s) => {
                            const next = new Set(s)
                            if (next.has(o.id)) next.delete(o.id)
                            else next.add(o.id)
                            return next
                          })
                        }
                        aria-label={`Select ${phone(o.buyer_phone)} for a bulk outcome`}
                      />
                    )}
                  <div className="min-w-[13rem] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}
                        className="font-mono text-[13.5px] font-medium text-primary-text hover:underline"
                      >
                        {phone(o.buyer_phone)}
                      </Link>
                      {/* Band + the actual score, so the row says how risky the
                          buyer looks without a trip to Buyer Lookup. The
                          delivery status is gone from these rows: the tab
                          already says it, so "Pending" on every row of the
                          Pending tab was noise. */}
                      <VerdictBadge riskScore={o.buyers?.risk_score} totalOrders={o.buyers?.total_orders} />
                    </div>
                    <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                      {facts.map((f, i) => (
                        <span key={i}>
                          {i > 0 && <span aria-hidden="true"> · </span>}
                          <span className={i === 2 ? 'tabular-nums' : undefined}>{f}</span>
                        </span>
                      ))}
                    </p>
                  </div>

                  <div className="shrink-0">
                    {/*
                     * Accept stays green and Refuse stays red on a PENDING row —
                     * that colour is the affordance. On a RESOLVED row the
                     * outcome already chosen keeps its colour and the other
                     * button goes neutral, so the edit option reads as secondary.
                     */}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          'h-11 gap-1.5 px-3 md:h-9',
                          status === 'pending' || status === 'accepted'
                            ? 'border-risk-safe/50 bg-risk-safe-badge-bg text-risk-safe-badge hover:bg-risk-safe-badge-hover hover:text-risk-safe-badge'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                        disabled={busy || status === 'accepted'}
                        aria-pressed={status === 'accepted'}
                        onClick={() => void mark(o, 'accepted')}
                        aria-label={
                          status === 'accepted'
                            ? `${phone(o.buyer_phone)} is accepted`
                            : `Change ${phone(o.buyer_phone)} to accepted`
                        }
                      >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                        {status === 'accepted' ? 'Accepted' : 'Accept'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          'h-11 gap-1.5 px-3 md:h-9',
                          status === 'pending' || status === 'refused'
                            ? 'border-risk-high/50 bg-risk-high-badge-bg text-risk-high-badge hover:bg-risk-high-badge-hover hover:text-risk-high-badge'
                            : 'border-border text-muted-foreground hover:text-foreground',
                        )}
                        disabled={busy || status === 'refused'}
                        aria-pressed={status === 'refused'}
                        onClick={() => void mark(o, 'refused')}
                        aria-label={
                          status === 'refused'
                            ? `${phone(o.buyer_phone)} is refused`
                            : `Change ${phone(o.buyer_phone)} to refused`
                        }
                      >
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                        {status === 'refused' ? 'Refused' : 'Refuse'}
                      </Button>
                    </div>
                  </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </PageShell>
  )
}
