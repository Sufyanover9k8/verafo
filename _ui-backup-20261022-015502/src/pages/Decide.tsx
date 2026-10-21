import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, MessageCircle, Phone, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { PageShell } from '@/components/app/page-shell'
import { CardState } from '@/components/app/card-state'
import { VerdictBadge } from '@/components/app/verdict-badge'
import { RowActions } from '@/components/app/row-actions'
import { EmptyHint } from '@/components/app/empty-hint'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useSession } from '@/lib/session'
import { useStoreScope } from '@/lib/store'
import { isConfigured, supabase } from '@/lib/supabase'
import { useToast } from '@/lib/toast'
import { phone, timeAgo } from '@/lib/format'
import { hasEnoughData, riskFactors } from '@/lib/risk'
import { confirmOrderMessage, formatPKR } from '@/lib/ui'
import {
  DECISION_META,
  latestByOrder,
  recommend,
  validateDecision,
  type Decision,
  type DecisionRecord,
} from '@/lib/ui/decisions'
import { NeedsSetup } from '@/components/States'

interface QueueBuyer {
  phone: string
  risk_score: number
  total_orders: number
  total_accepted: number
  total_refused: number
}

interface QueueOrder {
  id: string
  buyer_phone: string
  product_name: string | null
  product_category: string | null
  price: number | null
  quantity: number | null
  city: string | null
  ordered_at: string | null
  stores?: { name: string } | null
  outcomes?: { status: string | null } | null
  buyers?: QueueBuyer | null
}

const btn =
  'inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50 md:h-9'

export function Decide() {
  const toast = useToast()
  const { email } = useSession()
  const { store, scopeStoreIds } = useStoreScope()

  const [orders, setOrders] = useState<QueueOrder[]>([])
  const [decisions, setDecisions] = useState<Map<string, DecisionRecord>>(new Map())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setLoadError(false)

    let q = supabase
      .from('orders')
      .select(
        'id, buyer_phone, product_name, product_category, price, quantity, city, ordered_at, stores(name), outcomes(status), buyers(phone, risk_score, total_orders, total_accepted, total_refused)',
      )
      .order('ordered_at', { ascending: false })
      .limit(200)
    if (store) q = q.eq('store_id', store.id)
    else if (scopeStoreIds) q = q.in('store_id', scopeStoreIds)

    const { data, error } = await q
    if (error) {
      setLoadError(true)
      toast.push({ kind: 'error', title: 'Could not load the queue', detail: error.message })
      setLoading(false)
      return
    }

    const rows = (data ?? []) as unknown as QueueOrder[]
    setOrders(rows)

    // Decisions are a separate table. If the migration has not been run yet,
    // the queue still works — it simply shows no history, and says so.
    const ids = rows.map((o) => o.id)
    if (ids.length > 0) {
      const { data: d, error: dErr } = await supabase
        .from('order_decisions')
        .select('id, order_id, decision, actor_email, note, created_at')
        .in('order_id', ids)
      if (!dErr) setDecisions(latestByOrder((d ?? []) as DecisionRecord[]))
    }
    setLoading(false)
  }, [toast, store, scopeStoreIds])

  useEffect(() => {
    void load()
  }, [load])

  async function record(order: QueueOrder, decision: Decision) {
    if (!supabase || saving) return

    const problem = validateDecision({ decision, orderId: order.id, actorEmail: email })
    if (problem) {
      toast.push({ kind: 'error', title: 'Could not record that', detail: problem })
      return
    }

    setSaving(order.id)
    try {
      const { error } = await supabase.from('order_decisions').insert({
        order_id: order.id,
        decision,
        actor_email: email,
      })
      if (error) throw error

      setDecisions((prev) => {
        const next = new Map(prev)
        next.set(order.id, {
          id: `local-${order.id}`,
          order_id: order.id,
          decision,
          actor_email: email ?? null,
          note: null,
          created_at: new Date().toISOString(),
        })
        return next
      })

      // "Call" and "Confirm on WhatsApp" also open the channel, so the
      // merchant does not have to tap twice.
      if (decision === 'confirm_whatsapp') {
        const msg = confirmOrderMessage({
          storeName: order.stores?.name ?? store?.name ?? null,
          amount: order.price == null ? null : order.price * (order.quantity ?? 1),
          product: order.product_name || order.product_category || null,
        })
        const { whatsappLink } = await import('@/lib/ui')
        const href = whatsappLink(order.buyer_phone, msg)
        if (href) window.open(href, '_blank', 'noreferrer')
      }
      if (decision === 'call') {
        const { telLink } = await import('@/lib/ui')
        const href = telLink(order.buyer_phone)
        // assign(), not an assignment to location.href: the assignment form is
        // flagged as mutating a value defined outside the component.
        if (href) window.location.assign(href)
      }

      toast.push({ kind: 'success', title: `${DECISION_META[decision].label} recorded` })
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not record that decision',
        detail:
          err instanceof Error && /order_decisions/.test(err.message)
            ? 'The order_decisions table is missing. Run supabase/order-decisions-migration.sql.'
            : err instanceof Error
              ? err.message
              : String(err),
      })
    } finally {
      setSaving(null)
    }
  }

  /** Pending orders only — a real outcome removes an order from the queue. */
  const queue = useMemo(() => {
    const pending = orders.filter((o) => (o.outcomes?.status ?? 'pending') === 'pending')
    return showDone ? pending : pending.filter((o) => !decisions.has(o.id))
  }, [orders, decisions, showDone])

  const pendingCount = useMemo(
    () => orders.filter((o) => (o.outcomes?.status ?? 'pending') === 'pending').length,
    [orders],
  )

  if (!isConfigured) return <NeedsSetup />

  return (
    <PageShell>
      <PageHeader
        title="Decide"
        description="Work through the orders that still need a call. Different from recording an outcome — this is what you decided before shipping."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btn}
              aria-pressed={showDone}
              onClick={() => setShowDone((v) => !v)}
            >
              <History className="size-3.5" />
              {showDone ? 'Hide decided' : 'Show decided'}
            </button>
            <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={() => void load()} disabled={loading}>
              Refresh
            </Button>
          </div>
        }
      />

      <CardState
        loading={loading}
        error={loadError ? 'We could not load the queue.' : null}
        onRetry={() => void load()}
        empty={queue.length === 0}
        skeletonHeight={280}
      >
        {queue.length === 0 ? (
          <Card className="gap-0 p-6">
            <EmptyHint
              large
              title={pendingCount === 0 ? 'Nothing is waiting for a decision' : 'Every waiting order has a decision'}
              detail={
                pendingCount === 0
                  ? 'Orders appear here as they come in, until their outcome is recorded.'
                  : 'Switch on “Show decided” to see what you chose.'
              }
            />
          </Card>
        ) : (
          <ul className="flex list-none flex-col gap-4 p-0">
            {queue.map((order) => {
              const buyer = order.buyers ?? null
              const scored = buyer != null && hasEnoughData(buyer.total_orders)
              const rec = recommend({
                riskScore: scored ? buyer!.risk_score : null,
                totalOrders: buyer?.total_orders ?? 0,
                totalRefused: buyer?.total_refused ?? 0,
                amount: order.price == null ? null : order.price * (order.quantity ?? 1),
              })
              const decided = decisions.get(order.id)
              const reasons = scored
                ? riskFactors({
                    risk_score: buyer!.risk_score,
                    total_orders: buyer!.total_orders,
                    total_accepted: buyer!.total_accepted,
                    total_refused: buyer!.total_refused,
                  }).slice(0, 4)
                : []

              return (
                <li key={order.id}>
                  <Card className="gap-0 p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Link
                          to={`/lookup?phone=${encodeURIComponent(order.buyer_phone)}`}
                          className="font-mono text-[14px] font-semibold text-primary-text hover:underline"
                        >
                          {phone(order.buyer_phone)}
                        </Link>
                        <p className="mt-1 truncate text-[14px] text-foreground">
                          {order.product_name || order.product_category || 'Order'}
                        </p>
                        <p className="mt-1 text-[13px] text-muted-foreground">
                          {[
                            order.city,
                            order.price == null ? null : formatPKR(order.price * (order.quantity ?? 1)),
                            timeAgo(order.ordered_at),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {decided && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-risk-safe/40 bg-risk-safe-soft px-2.5 py-1 text-[12.5px] font-semibold text-risk-safe-strong">
                            <Check className="size-3.5" /> {DECISION_META[decided.decision].label}
                          </span>
                        )}
                        <VerdictBadge
                          riskScore={buyer?.risk_score}
                          totalOrders={buyer?.total_orders}
                        />
                      </div>
                    </div>

                    {/* What Verafo suggests, and why. */}
                    <p
                      className={cn(
                        'mt-4 rounded-[10px] border px-3 py-2.5 text-[13.5px]',
                        rec.tone === 'high'
                          ? 'border-risk-high/40 bg-risk-high-soft text-foreground'
                          : rec.tone === 'watch'
                            ? 'border-risk-watch/40 bg-risk-watch-soft text-foreground'
                            : rec.tone === 'safe'
                              ? 'border-risk-safe/40 bg-risk-safe-soft text-foreground'
                              : 'border-border bg-muted text-foreground',
                      )}
                    >
                      <span className="font-semibold">Suggested: {DECISION_META[rec.decision].label}. </span>
                      {rec.reason}
                    </p>

                    {reasons.length > 0 && (
                      <ul className="mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-muted-foreground">
                        {reasons.map((f, i) => (
                          <li key={i} className="flex items-center gap-1.5">
                            <span
                              aria-hidden="true"
                              className={cn(
                                'size-1.5 rounded-full',
                                f.impact === 'neg' ? 'bg-risk-high' : f.impact === 'pos' ? 'bg-risk-safe' : 'bg-risk-unknown',
                              )}
                            />
                            {f.label}
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* The four decisions. */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(Object.keys(DECISION_META) as Decision[]).map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={btn}
                          disabled={saving === order.id}
                          title={DECISION_META[d].help}
                          onClick={() => void record(order, d)}
                        >
                          {d === 'confirm_whatsapp' ? (
                            <MessageCircle className="size-3.5" />
                          ) : d === 'call' ? (
                            <Phone className="size-3.5" />
                          ) : d === 'hold' ? (
                            <History className="size-3.5" />
                          ) : (
                            <Check className="size-3.5" />
                          )}
                          {DECISION_META[d].label}
                        </button>
                      ))}
                      <RowActions
                        phone={order.buyer_phone}
                        message={confirmOrderMessage({
                          storeName: order.stores?.name ?? store?.name ?? null,
                          amount: order.price == null ? null : order.price * (order.quantity ?? 1),
                          product: order.product_name || order.product_category || null,
                        })}
                      />
                    </div>

                    <p className="mt-3 text-[11.5px] text-muted-foreground">
                      Recording a decision does not change the order, and never marks it delivered or refused.
                      Record the real outcome on the{' '}
                      <Link to="/orders/pending" className="text-primary-text hover:underline">
                        Outcomes
                      </Link>{' '}
                      page once you know it.
                    </p>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </CardState>
    </PageShell>
  )
}
