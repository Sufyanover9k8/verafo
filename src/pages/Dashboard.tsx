import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Banknote, Gauge, Package, PackageX, RefreshCw } from 'lucide-react'
import { GeoMap } from '@/components/charts/GeoMap'
import { NeedsSetup } from '@/components/States'
import { PageHeader } from '@/components/app/page-header'
import { PageShell } from '@/components/app/page-shell'
import { Segmented } from '@/components/app/segmented'
import { StatusBadge } from '@/components/app/status-badge'
import { MetricTrend, TrendArea, type MetricSeries } from '@/components/app/charts'
import { KpiCard, RiskDonut, type DonutSlice } from '@/components/app/kpi-cards'
import { VerdictBadge } from '@/components/app/verdict-badge'
import { CardState } from '@/components/app/card-state'
import { VerdictCard } from '@/components/app/verdict-card'
import { RowActions } from '@/components/app/row-actions'
import { CountUp } from '@/components/app/count-up'
import { briefingLine } from '@/components/app/briefing-line'
import { FirstRunChecklist, MoneyRiskCards } from '@/components/app/dashboard-extras'
import { InsightCards } from '@/components/app/insight-cards'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { money, phone, timeAgo } from '@/lib/format'
import { greetingForName } from '@/lib/greeting'
import { hasEnoughData, toneFromScore, type VerdictTone } from '@/lib/risk'
import { confirmOrderMessage } from '@/lib/ui'
import { useAutoRefresh, useNowTicker } from '@/lib/ui/use-auto-refresh'
import { useSession } from '@/lib/session'
import { isConfigured, supabase } from '@/lib/supabase'
import { computeCityStats, computeDailySales, computeTopProducts } from '@/lib/storeStats'
import { useStoreScope } from '@/lib/store'
import { useToast } from '@/lib/toast'
import type { DailySalesRow, NetworkKpis, OrderRow } from '@/lib/types'
import type { RangeDays } from '@/components/RangeFilter'

interface BuyerLight {
  phone: string
  risk_score: number
  total_orders: number
}

function keyOf(d: Date): string {
  return d.toDateString()
}

/* Tone → presentation. Every colour is a token; the word is always shown
   alongside the colour, never the colour on its own. */
const TONE_UI: Record<
  VerdictTone,
  { word: string; sentence: (n: number) => string; dot: string; text: string; soft: string; bar: string }
> = {
  safe: {
    word: 'SAFE',
    sentence: () => 'Nothing is waiting on you before you ship.',
    dot: 'bg-risk-safe',
    text: 'text-risk-safe-strong',
    soft: 'bg-risk-safe-soft',
    bar: 'bg-risk-safe',
  },
  watch: {
    word: 'MEDIUM',
    sentence: (n) => `${n} order${n === 1 ? '' : 's'} need a look before you ship.`,
    dot: 'bg-risk-watch',
    text: 'text-risk-watch-strong',
    soft: 'bg-risk-watch-soft',
    bar: 'bg-risk-watch',
  },
  high: {
    word: 'HIGH',
    sentence: (n) => `${n} order${n === 1 ? '' : 's'} look risky. Check them first.`,
    dot: 'bg-risk-high',
    text: 'text-risk-high-strong',
    soft: 'bg-risk-high-soft',
    bar: 'bg-risk-high',
  },
  unknown: {
    word: 'UNKNOWN',
    sentence: () => 'Not enough data yet. Scores appear as orders come in.',
    dot: 'bg-risk-unknown',
    text: 'text-risk-unknown-strong',
    soft: 'bg-risk-unknown-soft',
    bar: 'bg-risk-unknown',
  },
}

interface ToneBucket {
  tone: VerdictTone
  label: string
  n: number
}

export function Dashboard() {
  const toast = useToast()
  const { role, store, scopeStoreIds } = useStoreScope()
  const { displayName } = useSession()
  const isAdmin = role === 'admin'
  /** Which series the volume chart is showing. Orders is always available. */
  const [metrics, setMetrics] = useState<string[]>(['orders'])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [buyers, setBuyers] = useState<BuyerLight[]>([])
  const [sales, setSales] = useState<DailySalesRow[]>([])
  const [kpis, setKpis] = useState<NetworkKpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [ordersError, setOrdersError] = useState(false)
  const [buyersError, setBuyersError] = useState(false)
  const [salesError, setSalesError] = useState(false)
  const [range, setRange] = useState<RangeDays>(7)
  /** When the last successful load finished, for the "Updated…" line. */
  const [lastLoaded, setLastLoaded] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setOrdersError(false)
    setBuyersError(false)
    setSalesError(false)

    let ordersQuery = supabase
      .from('orders')
      .select('*, stores(name), outcomes(status, resolved_at)')
      .order('ordered_at', { ascending: false })
      .limit(500)
    if (store) ordersQuery = ordersQuery.eq('store_id', store.id)
    else if (scopeStoreIds) ordersQuery = ordersQuery.in('store_id', scopeStoreIds)

    const ordersRes = await ordersQuery
    const ordersData = (ordersRes.data ?? []) as OrderRow[]

    if (ordersRes.error) {
      setOrdersError(true)
      toast.push({ kind: 'error', title: 'Could not load orders', detail: ordersRes.error.message })
    } else {
      setOrders(ordersData)
    }

    // Buyers for the risk distribution. Admin → whole network. Merchant → only
    // buyers who have ordered from their store(s).
    if (isAdmin) {
      const { data, error: buyersErr } = await supabase.from('buyers').select('phone, risk_score, total_orders').limit(5000)
      if (buyersErr) {
        setBuyersError(true)
        toast.push({ kind: 'error', title: 'Could not load buyers', detail: buyersErr.message })
      } else setBuyers((data ?? []) as BuyerLight[])
    } else {
      const phones = [...new Set(ordersData.map((o) => o.buyer_phone).filter(Boolean))]
      if (phones.length === 0) {
        setBuyers([])
      } else {
        const { data, error: buyersErr } = await supabase
          .from('buyers')
          .select('phone, risk_score, total_orders')
          .in('phone', phones.slice(0, 1000))
        if (buyersErr) {
          setBuyersError(true)
          toast.push({ kind: 'error', title: 'Could not load buyers', detail: buyersErr.message })
        } else setBuyers((data ?? []) as BuyerLight[])
      }
    }

    // Network RPCs are admin-only; merchants use the client-side fallbacks.
    if (isAdmin) {
      const [salesRes, kpisRes] = await Promise.all([
        supabase.rpc('daily_sales', { p_days: range }),
        supabase.rpc('network_kpis'),
      ])
      if (salesRes.error) {
        setSalesError(true)
        setSales(computeDailySales(ordersData, range))
      } else setSales((salesRes.data ?? []) as DailySalesRow[])
      if (!kpisRes.error) setKpis((kpisRes.data?.[0] ?? null) as NetworkKpis | null)
    } else {
      setSales(computeDailySales(ordersData, range))
      setKpis(null)
    }

    setLoading(false)
    setLastLoaded(Date.now())
  }, [toast, range, isAdmin, store, scopeStoreIds])

  useEffect(() => {
    void load()
  }, [load])

  // Keep the numbers fresh while the merchant is looking at them. Pauses when
  // the tab is hidden, and never runs two loads at once.
  useAutoRefresh(load, 90_000, !loading)
  useNowTicker(lastLoaded != null && !loading)

  const riskByPhone = useMemo(() => {
    const m = new Map<string, BuyerLight>()
    for (const b of buyers) m.set(b.phone, b)
    return m
  }, [buyers])

  const stats = useMemo(() => {
    const now = new Date()
    const today = keyOf(now)

    let todayOrders = 0
    let todayRevenue = 0
    for (const o of orders) {
      if (!o.ordered_at) continue
      if (keyOf(new Date(o.ordered_at)) !== today) continue
      todayOrders++
      todayRevenue += (o.price ?? 0) * (o.quantity ?? 1)
    }

    const avg =
      buyers.length > 0 ? buyers.reduce((sum, b) => sum + b.risk_score, 0) / buyers.length : 0.5
    const pending = orders.filter((o) => !o.outcomes || o.outcomes.status === 'pending').length

    // Averages real only when the caller asked for an average.
    const averageOf = (values: number[]) =>
      values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null

    const dayCount = new Map<string, number>()
    for (const o of orders) {
      if (!o.ordered_at) continue
      const k = keyOf(new Date(o.ordered_at))
      dayCount.set(k, (dayCount.get(k) ?? 0) + 1)
    }

    /**
     * Buckets by whole days back from today, so an order placed this morning
     * cannot fall outside a window. `wantRisk` adds the average risk score of
     * the buyers who ordered that day — presented as a TREND, never as a
     * per-order score, which this app does not have.
     */
    const days: { label: string; orders: number; revenue: number; risk: number | null }[] = []
    const spendByDay = new Map<string, number>()
    const riskByDay = new Map<string, number[]>()
    for (const o of orders) {
      if (!o.ordered_at) continue
      const k = keyOf(new Date(o.ordered_at))
      if (o.price != null) spendByDay.set(k, (spendByDay.get(k) ?? 0) + (o.price ?? 0) * (o.quantity ?? 1))
      const b = riskByPhone.get(o.buyer_phone)
      // Only buyers who have actually resolved an order are scored; an
      // unscored buyer sits at the neutral 0.5 and would flatten the trend.
      if (b != null && hasEnoughData(b.total_orders)) {
        const list = riskByDay.get(k)
        if (list) list.push(b.risk_score)
        else riskByDay.set(k, [b.risk_score])
      }
    }
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000)
      const k = keyOf(d)
      days.push({
        label: d.toLocaleDateString('en-GB', range === 30 ? { day: 'numeric', month: 'short' } : { weekday: 'short' }),
        orders: dayCount.get(k) ?? 0,
        revenue: spendByDay.get(k) ?? 0,
        risk: averageOf(riskByDay.get(k) ?? []),
      })
    }

    /** Totals for any whole-day window ending `offsetDays` ago. */
    const windowTotals = (offsetDays: number) => {
      const from = new Date(now.getTime() - (offsetDays + range - 1) * 86400000)
      from.setHours(0, 0, 0, 0)
      const toExclusive = new Date(now.getTime() - offsetDays * 86400000)
      toExclusive.setHours(0, 0, 0, 0)
      let count = 0
      let revenue = 0
      let refused = 0
      let priced = false
      for (const o of orders) {
        if (!o.ordered_at) continue
        const t = new Date(o.ordered_at).getTime()
        if (t < from.getTime() || t >= toExclusive.getTime()) continue
        count++
        if (o.outcomes?.status === 'refused') refused++
        if (o.price != null) {
          priced = true
          revenue += (o.price ?? 0) * (o.quantity ?? 1)
        }
      }
      return { count, revenue: priced ? revenue : null, refused }
    }

    /** Percentage change, or null when the window before cannot support one. */
    const deltaOf = (nowValue: number | null, prevValue: number | null, minBase: number) => {
      if (nowValue == null || prevValue == null) return null
      if (prevValue < minBase) return null
      return ((nowValue - prevValue) / prevValue) * 100
    }

    const current = windowTotals(0)
    const previous = windowTotals(range)
    // MIN_DELTA_SAMPLE: below this the previous window is too thin to compare.
    const MIN_DELTA_SAMPLE = 5

    return {
      todayOrders,
      todayRevenue,
      avg,
      pending,
      days,
      current,
      previous,
      deltas: {
        orders: deltaOf(current.count, previous.count, MIN_DELTA_SAMPLE),
        revenue: deltaOf(current.revenue, previous.revenue, MIN_DELTA_SAMPLE),
        refused: deltaOf(current.refused, previous.refused, MIN_DELTA_SAMPLE),
      },
    }
  }, [orders, buyers, range, riskByPhone])

  const filteredOrders = useMemo(() => {
    const cutoff = new Date().getTime() - (range - 1) * 86400000
    return orders.filter((o) => !o.ordered_at || new Date(o.ordered_at).getTime() >= cutoff)
  }, [orders, range])

  const recent = filteredOrders.slice(0, 8)

  /** Every pending order from a buyer with enough history to already look
   *  risky, worst first. This one list drives both the verdict and the
   *  "Needs your attention" card, so they can never disagree. */
  const riskyPending = useMemo(() => {
    return orders
      .filter((o) => !o.outcomes || o.outcomes.status === 'pending')
      .map((o) => ({ order: o, buyer: riskByPhone.get(o.buyer_phone) }))
      .filter(
        ({ buyer }) =>
          buyer && hasEnoughData(buyer.total_orders) && toneFromScore(buyer.risk_score) !== 'safe',
      )
      .sort((a, b) => (b.buyer?.risk_score ?? 0) - (a.buyer?.risk_score ?? 0))
  }, [orders, riskByPhone])

  /** What the card shows. */
  const attention = useMemo(() => riskyPending.slice(0, 6), [riskyPending])

  const cityStats = useMemo(() => computeCityStats(filteredOrders), [filteredOrders])
  const topProducts = useMemo(() => computeTopProducts(filteredOrders), [filteredOrders])

  const pending = kpis?.pending_orders ?? stats.pending

  const salesData = sales.map((s) => ({
    label: new Date(s.day).toLocaleDateString('en-GB', range === 30 ? { day: 'numeric', month: 'short' } : { weekday: 'short' }),
    a: s.revenue,
  }))

  /** The book split into the four risk bands. Buyers with no resolved orders
   *  stay UNKNOWN — they are never counted as safe. */
  const buckets = useMemo<ToneBucket[]>(() => {
    const d = { safe: 0, watch: 0, high: 0, unknown: 0 }
    for (const b of buyers) {
      if (!hasEnoughData(b.total_orders)) {
        d.unknown++
        continue
      }
      d[toneFromScore(b.risk_score)]++
    }
    return [
      { tone: 'safe', label: 'LOW', n: d.safe },
      { tone: 'watch', label: 'MEDIUM', n: d.watch },
      { tone: 'high', label: 'HIGH', n: d.high },
      { tone: 'unknown', label: 'UNKNOWN', n: d.unknown },
    ]
  }, [buyers])

  /** Is any buyer scored at all? If nobody is, the answer has to be UNKNOWN. */
  const hasScoredBuyers = buckets.some((b) => b.tone !== 'unknown' && b.n > 0)

  /**
   * The verdict, about right now — never about the 7/30 day window.
   * HIGH if any risky-pending order is HIGH, else MEDIUM if any is MEDIUM,
   * else SAFE when there is nothing waiting and we have scored buyers.
   * UNKNOWN when there is not enough data. Never SAFE without data.
   */
  const verdict: VerdictTone = useMemo(() => {
    if (riskyPending.some(({ buyer }) => toneFromScore(buyer!.risk_score) === 'high')) return 'high'
    if (riskyPending.length > 0) return 'watch'
    return hasScoredBuyers ? 'safe' : 'unknown'
  }, [riskyPending, hasScoredBuyers])

  /** The N in the sentence — the number of orders actually in that list. */
  const attentionCount = riskyPending.length

  /** High-risk orders that are waiting for a decision. Same list as the
   *  "Needs your attention" card, so the hero can never disagree with it.
   *  The all-buyers total lives only in the Risk distribution card. */
  const highRiskWaiting = riskyPending.filter(
    ({ buyer }) => toneFromScore(buyer!.risk_score) === 'high',
  ).length

  /** PKR sitting in pending orders from buyers who look MEDIUM or HIGH. */
  const codAtRisk = useMemo(() => {
    let sum = 0
    let any = false
    for (const { order } of riskyPending) {
      if (order.price == null) continue
      any = true
      sum += (order.price ?? 0) * (order.quantity ?? 1)
    }
    return any ? sum : null
  }, [riskyPending])

  /** PKR lost to refusals inside the selected period, from recorded outcomes. */
  const lostToRefusals = useMemo(() => {
    const cutoff = new Date().getTime() - (range - 1) * 86400000
    let sum = 0
    let any = false
    for (const o of orders) {
      if (o.outcomes?.status !== 'refused') continue
      if (o.ordered_at && new Date(o.ordered_at).getTime() < cutoff) continue
      if (o.price == null) continue
      any = true
      sum += (o.price ?? 0) * (o.quantity ?? 1)
    }
    return any ? sum : null
  }, [orders, range])

  /** The riskiest waiting order, for the briefing line. */
  const riskiest = riskyPending[0] ?? null

  // No per-buyer signals here: "New delivery address" and friends describe ONE
  // buyer's order, so they belong in Buyer Lookup, not on a store-level card.

  /** Setup progress, read off data already loaded. */
  const earlySignals = useMemo(() => {
    const anyScored = orders.some((o) => {
      const b = riskByPhone.get(o.buyer_phone)
      return b != null && hasEnoughData(b.total_orders)
    })
    const anyOutcome = orders.some((o) => o.outcomes && o.outcomes.status !== 'pending')
    return { anyScored, anyOutcome }
  }, [orders, riskByPhone])

  if (!isConfigured) return <NeedsSetup />

  const ui = TONE_UI[verdict]
  const heroSentence = ui.sentence(attentionCount)

  /**
   * The number the hero shows. It must be the score behind the WORDS.
   *
   * The verdict word comes from the riskiest order waiting on a decision, so
   * pairing it with the all-buyers average made the card argue with itself: a
   * HIGH RISK headline sat next to 0.49, which this app's own thresholds call
   * MEDIUM. The riskiest waiting order's score is what actually produced the
   * word, so it is what the ring shows. The book average keeps its own honest
   * home in the "Average risk" KPI, where its band word is shown beside it.
   */
  const ringScore = riskiest != null ? Number(riskiest.buyer!.risk_score) : null
  const ringCaption = riskiest != null ? 'riskiest waiting' : 'risk score'

  /** The band the average score falls in. Shown as a word next to the number,
   *  and only when buyers have enough resolved orders to be scored. */
  const averageBand: VerdictTone =
    buyers.length > 0 && hasEnoughData(buyers[0]?.total_orders ?? 0) ? toneFromScore(stats.avg) : 'unknown'

  const distTotal = buckets.reduce((sum, b) => sum + b.n, 0)

  /** "7 days" / "30 days", for the period-aware empty states below. */
  const periodLabel = range === 30 ? '30 days' : '7 days'
  /**
   * The trend cards are empty for the CHOSEN PERIOD. When orders exist outside
   * it, saying "No orders in this period yet" reads like a broken page, so the
   * message names the window instead.
   */
  const trendEmptyText = (what: 'orders' | 'sales') => {
    const inPeriod =
      what === 'sales'
        ? salesData.some((d) => d.a > 0)
        : stats.days.some((d) => d.orders > 0)
    if (inPeriod) return `No ${what} yet.`
    return orders.length > 0 ? `No ${what} in the last ${periodLabel}.` : `No ${what} yet.`
  }

  /* ── The top-band figures ───────────────────────────────── */

  const deltaLabel = `vs previous ${periodLabel}`

  const kpiCards = [
    {
      label: `Orders · last ${periodLabel}`,
      value: stats.current.count.toLocaleString('en-PK'),
      icon: Package,
      delta: stats.deltas.orders,
      deltaLabel,
      upIsGood: true,
      hint: 'Orders placed in this period',
    },
    {
      label: `Revenue · last ${periodLabel}`,
      value: stats.current.revenue == null ? '—' : money(stats.current.revenue),
      icon: Banknote,
      delta: stats.deltas.revenue,
      deltaLabel,
      upIsGood: true,
      hint: 'No order in this period carries a price',
    },
    {
      label: `Refused · last ${periodLabel}`,
      value: stats.current.refused.toLocaleString('en-PK'),
      icon: PackageX,
      delta: stats.deltas.refused,
      deltaLabel,
      upIsGood: false,
      hint: 'Orders marked refused, returned to origin',
    },
    {
      label: 'Average risk',
      value: stats.avg.toFixed(2),
      icon: Gauge,
      delta: null,
      hint: `${TONE_UI[averageBand].word} · ${buyers.length} buyer${buyers.length === 1 ? '' : 's'} scored`,
    },
  ]

  /** Series the volume chart can show. Two axes only, so nothing is compared
   *  against a scale it does not belong to. */
  const metricSeries: MetricSeries[] = [
    {
      key: 'orders',
      name: 'Orders',
      color: 'var(--chart-1)',
      format: (n) => `${Math.round(n)}`,
      axis: 'left',
    },
    {
      key: 'revenue',
      name: 'Revenue',
      color: 'var(--chart-3)',
      format: (n) => money(n),
      axis: 'right',
    },
    {
      key: 'risk',
      name: 'Average risk',
      color: 'var(--chart-4)',
      format: (n) => n.toFixed(2),
      axis: 'right',
    },
  ]

  const metricData = stats.days.map((d) => ({
    label: d.label,
    orders: d.orders,
    revenue: d.revenue,
    risk: d.risk ?? 0,
  }))

  const donutSlices: DonutSlice[] = buckets.map((b) => ({
    label: b.label,
    value: b.n,
    band: b.tone,
  }))

  const subtitle = loading ? (
    'Checking your orders…'
  ) : orders.length === 0 ? (
    <span>
      Verafo scores every buyer from their first resolved order.{' '}
      {/* Hand-logging an order is a Verafo-team tool now, so a merchant is
          pointed at the route they actually have: their own history. */}
      {isAdmin ? (
        <>
          <Link className="font-medium text-primary-text underline-offset-4 hover:underline" to="/orders/new">
            Log an order
          </Link>{' '}
          or{' '}
        </>
      ) : null}
      <Link className="font-medium text-primary-text underline-offset-4 hover:underline" to="/import">
        import your history
      </Link>{' '}
      to begin.
    </span>
  ) : (
    <span>
      {isAdmin ? 'Across the network' : store?.name ?? 'Your store'} · {pending} order
      {pending === 1 ? '' : 's'} awaiting a verdict.
    </span>
  )

  return (
    <PageShell>
      <PageHeader
        title={greetingForName(displayName)}
        description={
          <span>
            <span className="font-medium text-foreground">Is my store safe today?</span> {subtitle}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              ariaLabel="Date range"
              value={range}
              onChange={setRange}
              options={[
                { value: 7, label: '7 days' },
                { value: 30, label: '30 days' },
              ]}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-11 gap-1.5 md:h-9"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /> Refresh
            </Button>
            {lastLoaded != null && !loading && (
              <span className="text-[12.5px] text-muted-foreground">
                Updated {timeAgo(new Date(lastLoaded).toISOString())}
              </span>
            )}
          </div>
        }
      />

      {/* The period at a glance, with real period-over-period movement. */}
      {!loading && !ordersError && orders.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          {kpiCards.map((k) => (
            <KpiCard
              key={k.label}
              label={k.label}
              value={k.value}
              icon={k.icon}
              delta={k.delta}
              deltaLabel={deltaLabel}
              upIsGood={k.upIsGood}
              hint={k.hint}
            />
          ))}
        </div>
      )}

      {/* The answer, first: one briefing line, then the verdict card. */}
      {!loading && !ordersError && (
        <p className="text-[15px] font-medium text-foreground">
          {briefingLine({
            waiting: attentionCount,
            riskiestCity: riskiest?.order.city ?? null,
            riskiestAmount:
              riskiest?.order.price == null ? null : riskiest.order.price * (riskiest.order.quantity ?? 1),
            scoredBuyers: buyers.filter((b) => hasEnoughData(b.total_orders)).length,
          })}
        </p>
      )}

      <VerdictCard
        tone={verdict}
        score={verdict === 'unknown' ? null : ringScore}
        ringCaption={ringCaption}
        sentence={heroSentence}
        footnote={`Based on your latest ${orders.length.toLocaleString('en-PK')} orders.`}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-[13px] text-muted-foreground">
            <CountUp value={highRiskWaiting} className="me-1.5 text-base font-semibold text-foreground" />
            high risk, waiting
          </span>
          <span className="text-[13px] text-muted-foreground">
            <CountUp value={attentionCount} className="me-1.5 text-base font-semibold text-foreground" />
            need a look
          </span>
          <span className="text-[13px] text-muted-foreground">
            <CountUp value={pending} className="me-1.5 text-base font-semibold text-foreground" />
            awaiting a verdict
          </span>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          Based on your {attentionCount} order{attentionCount === 1 ? '' : 's'} waiting for a decision.
        </p>
        <div className="mt-4">
          <Button asChild className="h-11 w-full sm:w-auto">
            <Link to="/orders/pending">
              Review orders <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </VerdictCard>

      {/* Setup nudges live BELOW the answer, so the verdict is the first thing
          on the page. Hidden in the all-stores network view: an admin reading
          the whole network is not "finishing setting up" one store.
          "Store connected" is ticked when the store has orders — orders are
          proof the connection works, even before the profile is filled in. */}
      {!(isAdmin && !store) && (
        <FirstRunChecklist
          hasStore={Boolean(store) || orders.length > 0}
          hasScoredOrder={earlySignals.anyScored}
          hasOutcome={earlySignals.anyOutcome}
        />
      )}

      {/* Who needs you, and how risky the book is. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Needs your attention</CardTitle>
            <CardDescription>Pending orders from buyers who already look risky.</CardDescription>
            <div data-slot="card-action" className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
              <Button asChild variant="ghost" size="sm" className="h-11 gap-1.5 px-3 md:h-9">
                <Link to="/orders">
                  View all <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <CardState
              loading={loading}
              error={buyersError}
              onRetry={() => void load()}
              empty={attention.length === 0}
              emptyText="No order from a risky buyer is waiting on you."
              skeletonHeight={200}
            >
              <ul className="-mx-2 m-0 list-none divide-y divide-border p-0">
                {attention.map(({ order, buyer }) => (
                  <li key={order.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <Link
                        to={`/lookup?phone=${encodeURIComponent(order.buyer_phone)}`}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[10px] px-2 transition-colors hover:bg-muted/60"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-[13px] font-medium">{phone(order.buyer_phone)}</div>
                          <div className="truncate text-[13px] text-muted-foreground">
                            {order.product_name || order.product_category || 'Order'}
                          </div>
                        </div>
                        <VerdictBadge riskScore={buyer?.risk_score} totalOrders={buyer?.total_orders} />
                      </Link>
                      <RowActions
                        phone={order.buyer_phone}
                        message={confirmOrderMessage({
                          storeName: order.stores?.name ?? store?.name ?? null,
                          amount:
                            order.price == null ? null : order.price * (order.quantity ?? 1),
                          product: order.product_name || order.product_category || null,
                        })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11.5px] text-muted-foreground">
                These open your phone or WhatsApp. Verafo does not send messages for you.
              </p>
            </CardState>
          </CardContent>
        </Card>
      </div>

      {/* Volume over time, with a metric switcher. Revenue and average risk
          read on their own right-hand scale, so nothing is compared against an
          axis it does not belong to. */}
      <Card className="gap-0">
        <CardHeader>
          <CardTitle>Order volume &amp; risk trend</CardTitle>
          <CardDescription>
            Totals per day over the last {range} days.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            role="group"
            aria-label="Metrics shown"
            className="inline-flex flex-wrap items-center rounded-[10px] border border-border bg-muted/60 p-0.5"
          >
            {metricSeries.map((s) => {
              const on = metrics.includes(s.key)
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setMetrics((cur) =>
                      cur.includes(s.key)
                        ? // Never leave the chart with nothing to draw.
                          cur.length === 1
                          ? cur
                          : cur.filter((k) => k !== s.key)
                        : [...cur, s.key],
                    )
                  }
                  className={cn(
                    'inline-flex h-11 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium transition-colors md:h-8',
                    on
                      ? 'bg-card text-foreground shadow-1 ring-1 ring-border'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="size-2.5 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                  {s.name}
                </button>
              )
            })}
          </div>

          <CardState
            loading={loading}
            error={ordersError}
            onRetry={() => void load()}
            empty={stats.days.every((d) => d.orders === 0)}
            emptyText={trendEmptyText('orders')}
            skeletonHeight={260}
          >
            <MetricTrend
              data={metricData}
              series={metricSeries}
              active={metrics}
              label={`Orders, revenue and average risk per day over the last ${range} days`}
              emptyText={trendEmptyText('orders')}
            />
          </CardState>
        </CardContent>
      </Card>

      {/* How risky the book is, what COD is carrying, and the daily sales line
          the admin-only daily_sales function feeds. */}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="gap-0">
          <CardHeader>
            <CardTitle>Risk distribution</CardTitle>
            <CardDescription>
              {isAdmin ? 'Every buyer on the network.' : 'Buyers who ordered from your store.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CardState
              loading={loading}
              error={buyersError}
              onRetry={() => void load()}
              empty={distTotal === 0}
              emptyText="No buyers have been scored yet."
              skeletonHeight={200}
            >
              <RiskDonut slices={donutSlices} total={distTotal} />
            </CardState>
          </CardContent>
        </Card>

        {!loading && !ordersError && (
          <MoneyRiskCards
            codAtRisk={codAtRisk}
            lostToRefusals={lostToRefusals}
            rangeLabel={range === 30 ? '30 days' : '7 days'}
            basedOn={orders.length}
            layout="stack"
          />
        )}

        <Card className="gap-0">
          <CardHeader>
            <CardTitle>Sales</CardTitle>
            <CardDescription>Gross order value per day, last {range} days.</CardDescription>
          </CardHeader>
          <CardContent>
            <CardState
              loading={loading}
              error={salesError}
              onRetry={() => void load()}
              empty={salesData.length === 0 || salesData.every((d) => d.a === 0)}
              emptyText={trendEmptyText('sales')}
              skeletonHeight={200}
            >
              <TrendArea
                data={salesData.map((s) => ({ label: s.label, value: s.a }))}
                format={(n) => money(n)}
                height={210}
                label={`Gross order value per day over the last ${range} days`}
              />
            </CardState>
          </CardContent>
        </Card>
      </div>

      {/* Business insights, from the orders already loaded. Hidden when thin. */}
      {!loading && !ordersError && orders.length > 0 && (
        <InsightCards orders={orders} days={range} />
      )}

      {/* Where the money is. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sales by city</CardTitle>
            <CardDescription>Where your revenue comes from.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CardState
              loading={loading}
              error={ordersError}
              onRetry={() => void load()}
              empty={cityStats.length === 0}
              emptyText="No city data yet. Add a city when logging orders."
              skeletonHeight={280}
            >
              <div className="overflow-hidden rounded-[10px] border">
                <GeoMap cities={cityStats} height={240} />
              </div>
              <ul className="m-0 list-none space-y-3 p-0">
                {cityStats.slice(0, 5).map((c) => (
                  <li key={c.city} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium">
                        {c.city}{' '}
                        <span className="ms-1 text-xs font-normal text-muted-foreground">
                          {c.orders} order{c.orders === 1 ? '' : 's'}
                        </span>
                      </span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">{money(c.revenue)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, c.share)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </CardState>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
            <CardDescription>By revenue, last {range} days.</CardDescription>
          </CardHeader>
          <CardContent>
            <CardState
              loading={loading}
              error={ordersError}
              onRetry={() => void load()}
              empty={topProducts.length === 0}
              emptyText="No products logged yet."
              skeletonHeight={280}
            >
              <ol className="m-0 list-none divide-y divide-border p-0">
                {topProducts.slice(0, 7).map((p, i) => (
                  <li key={p.name} className="flex min-h-11 items-center gap-3 py-3">
                    <span className="w-5 text-xs font-medium text-muted-foreground tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-[13px] text-muted-foreground">
                        {p.orders} order{p.orders === 1 ? '' : 's'} · {p.share}% of sales
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">{money(p.revenue)}</span>
                  </li>
                ))}
              </ol>
            </CardState>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity. */}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-5">
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>The latest orders and how they ended up.</CardDescription>
          <div data-slot="card-action" className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
            <Button asChild variant="ghost" size="sm" className="h-11 gap-1.5 px-3 md:h-9">
              <Link to="/orders/pending">
                View outcomes <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardState
          loading={loading}
          error={ordersError}
          onRetry={() => void load()}
          empty={recent.length === 0}
          emptyText={isAdmin ? 'No orders in the network yet.' : 'No orders yet.'}
          skeletonHeight={200}
        >
          {/* Wide table scrolls inside its own box on phones. */}
          <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="ps-6">Buyer</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden md:table-cell">Store</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-end">Amount</TableHead>
                  <TableHead className="pe-6 text-end">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="ps-6">
                      <Link
                        to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}
                        className="font-mono text-[13px] text-primary-text hover:underline"
                      >
                        {phone(o.buyer_phone)}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate">{o.product_name || o.product_category || 'Untitled product'}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{o.stores?.name ?? 'Unknown store'}</TableCell>
                    <TableCell>
                      <StatusBadge status={o.outcomes?.status ?? 'pending'} />
                    </TableCell>
                    <TableCell className="text-end tabular-nums">{money((o.price ?? 0) * (o.quantity ?? 1))}</TableCell>
                    <TableCell className="pe-6 text-end text-muted-foreground">{timeAgo(o.ordered_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardState>
      </Card>
    </PageShell>
  )
}
