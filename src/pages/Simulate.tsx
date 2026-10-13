import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { PageHeader } from '@/components/app/page-header'
import { PageShell } from '@/components/app/page-shell'
import { CardState } from '@/components/app/card-state'
import { EmptyHint } from '@/components/app/empty-hint'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { isConfigured, supabase } from '@/lib/supabase'
import { useToast } from '@/lib/toast'
import { useStoreScope } from '@/lib/store'
import { formatPKR } from '@/lib/ui'
import {
  DEFAULT_RULES,
  RULE_BOUNDS,
  clampRules,
  explainResult,
  simulate,
  thresholdExplanation,
  type SimOrder,
  type SimRules,
} from '@/lib/ui/simulate'
import { NeedsSetup } from '@/components/States'

interface RawOrder {
  id: string
  buyer_phone: string | null
  price: number | null
  quantity: number | null
  outcomes?: { status: string | null } | null
  buyers?: { risk_score: number | null; total_orders: number | null } | null
}

export function Simulate() {
  const toast = useToast()
  const { store, scopeStoreIds } = useStoreScope()

  const [orders, setOrders] = useState<SimOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [rules, setRules] = useState<SimRules>(DEFAULT_RULES)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setLoadError(false)

    let q = supabase
      .from('orders')
      .select('id, buyer_phone, price, quantity, outcomes(status), buyers(risk_score, total_orders)')
      .order('ordered_at', { ascending: false })
      .limit(500)
    if (store) q = q.eq('store_id', store.id)
    else if (scopeStoreIds) q = q.in('store_id', scopeStoreIds)

    const { data, error } = await q
    if (error) {
      setLoadError(true)
      toast.push({ kind: 'error', title: 'Could not load orders', detail: error.message })
      setLoading(false)
      return
    }

    const mapped: SimOrder[] = ((data ?? []) as unknown as RawOrder[]).map((r) => {
      const raw = r.outcomes?.status
      return {
        id: r.id,
        price: r.price,
        quantity: r.quantity,
        outcome: raw === 'accepted' || raw === 'refused' ? raw : 'pending',
        riskScore: r.buyers?.risk_score ?? null,
        buyerOrders: r.buyers?.total_orders ?? null,
      }
    })
    setOrders(mapped)
    setLoading(false)
  }, [toast, store, scopeStoreIds])

  useEffect(() => {
    void load()
  }, [load])

  const safe = clampRules(rules)
  /** Recomputed on every control change. Pure — it cannot touch the database. */
  const result = useMemo(() => simulate(orders, safe), [orders, safe])
  const lines = useMemo(() => explainResult(result, safe), [result, safe])

  if (!isConfigured) return <NeedsSetup />

  const score = RULE_BOUNDS.scoreThreshold

  return (
    <PageShell>
      <PageHeader
        title="What-if simulator"
        description="Try a cash-on-delivery rule against your past orders. Nothing is saved and no rule is enforced."
      />

      {/* The read-only promise, stated before the controls. */}
      <Card className="gap-0 border-risk-safe/40 bg-risk-safe-soft p-5">
        <p className="flex items-start gap-2 text-[13.5px] text-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">This page only does sums.</strong> It reads the orders already
            loaded here and shows what a rule would have matched. It cannot change an order, an outcome, a
            delivery status or a decision, and it never sends anything to Shopify.
          </span>
        </p>
      </Card>

      <CardState
        loading={loading}
        error={loadError ? 'We could not load your orders.' : null}
        onRetry={() => void load()}
        empty={orders.length === 0}
        skeletonHeight={320}
      >
        {orders.length === 0 ? (
          <Card className="gap-0 p-6">
            <EmptyHint
              large
              title="No orders to test against"
              detail="Once this store has orders, come back and try a rule."
            />
          </Card>
        ) : (
          <>
            {/* Controls */}
            <Card className="gap-0 p-6">
              <h2 className="text-[15px] font-semibold text-foreground">The rule you are testing</h2>

              <div className="mt-5 flex flex-col gap-6">
                <div>
                  <label htmlFor="sim-score" className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[14px] font-medium text-foreground">
                      Hide cash on delivery at or above
                    </span>
                    <span className="font-mono text-[15px] font-semibold tabular-nums text-foreground">
                      {safe.scoreThreshold.toFixed(2)}
                    </span>
                  </label>
                  <input
                    id="sim-score"
                    type="range"
                    min={score.min}
                    max={score.max}
                    step={score.step}
                    value={safe.scoreThreshold}
                    onChange={(e) => setRules((r) => ({ ...r, scoreThreshold: Number(e.target.value) }))}
                    className="mt-2 h-11 w-full accent-[var(--teal)]"
                    aria-describedby="sim-score-help"
                  />
                  <p id="sim-score-help" className="text-[12.5px] text-muted-foreground">
                    {thresholdExplanation(safe.scoreThreshold)}
                  </p>
                </div>

                <div>
                  <label htmlFor="sim-value" className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[14px] font-medium text-foreground">
                      Also require confirmation above this order value
                    </span>
                    <span className="font-mono text-[15px] font-semibold tabular-nums text-foreground">
                      {safe.valueThreshold == null ? 'Off' : formatPKR(safe.valueThreshold)}
                    </span>
                  </label>
                  <input
                    id="sim-value"
                    type="range"
                    min={0}
                    max={RULE_BOUNDS.valueThreshold.max}
                    step={RULE_BOUNDS.valueThreshold.step}
                    value={safe.valueThreshold ?? 0}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      // 0 means the rule is off, so every toggle is reversible from the keyboard.
                      setRules((r) => ({ ...r, valueThreshold: v === 0 ? null : v }))
                    }}
                    className="mt-2 h-11 w-full accent-[var(--teal)]"
                    aria-describedby="sim-value-help"
                  />
                  <p id="sim-value-help" className="text-[12.5px] text-muted-foreground">
                    {safe.valueThreshold == null
                      ? 'Off. Only the risk score decides.'
                      : `Any order worth ${formatPKR(safe.valueThreshold)} or more also needs confirmation, whatever the score.`}
                  </p>
                </div>

                <div>
                  <label className="flex min-h-11 items-start gap-3">
                    <input
                      type="checkbox"
                      checked={safe.includeUnknown}
                      onChange={(e) => setRules((r) => ({ ...r, includeUnknown: e.target.checked }))}
                      className="mt-1 size-5 shrink-0 accent-[var(--teal)]"
                      aria-describedby="sim-unknown-help"
                    />
                    <span>
                      <span className="text-[14px] font-medium text-foreground">
                        Also ask buyers with too little history to confirm
                      </span>
                      <span id="sim-unknown-help" className="mt-0.5 block text-[12.5px] text-muted-foreground">
                        Off by default. Thin history is missing information, not a risk finding, so Verafo does
                        not treat it as risk unless you ask it to.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={() => setRules(DEFAULT_RULES)}>
                    Reset to default
                  </Button>
                </div>
              </div>
            </Card>

            {/* Results */}
            <Card className="gap-0 p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[15px] font-semibold text-foreground">What would have happened</h2>
                <p className="text-[11.5px] text-muted-foreground">
                  Hypothetical · based on your latest {orders.length.toLocaleString('en-PK')} orders
                </p>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  { key: 'affected', title: 'Would need confirmation', b: result.affected, tone: 'border-risk-watch/40 bg-risk-watch-soft' },
                  { key: 'untouched', title: 'Would ship as normal', b: result.untouched, tone: 'border-border bg-muted' },
                ].map((row) => (
                  <div key={row.key} className={`rounded-[16px] border p-5 ${row.tone}`}>
                    <p className="text-[11.5px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                      {row.title}
                    </p>
                    <p className="mt-2 font-mono text-[26px] leading-none font-semibold tabular-nums text-foreground">
                      {row.b.orders.toLocaleString('en-PK')}
                    </p>
                    <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                      orders · {row.b.resolved} resolved · {row.b.unknown} unknown
                    </p>
                    <p className="mt-3 text-[13px] text-foreground">
                      Order value: {row.b.value == null ? 'no prices recorded' : formatPKR(row.b.value)}
                    </p>
                    <p className="mt-1 text-[12.5px] text-muted-foreground">
                      Refusal rate:{' '}
                      {row.b.refusalRate == null ? 'not enough resolved orders' : `${Math.round(row.b.refusalRate * 100)}%`}
                    </p>
                  </div>
                ))}
              </div>

              <ul className="mt-5 flex list-none flex-col gap-2 border-t border-border p-0 pt-4">
                {lines.map((l) => (
                  <li key={l} className="text-[13px] text-muted-foreground">
                    {l}
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm" className="h-11 md:h-9">
                  <Link to="/orders">Inspect the orders</Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="h-11 md:h-9">
                  <Link to="/orders/scan">Run a historical scan</Link>
                </Button>
              </div>
              <p className="mt-4 text-[11.5px] text-muted-foreground">
                Turning these settings into a live rule is not available yet. This page is for planning only.
              </p>
            </Card>
          </>
        )}
      </CardState>
    </PageShell>
  )
}
