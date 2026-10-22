import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, RotateCcw, Sparkles } from 'lucide-react'
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { MapPoint3D } from '../components/Map3D'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Segmented } from '../components/app/segmented'
import { StatStrip, type StatItem } from '../components/app/stat-strip'
import { CardState } from '../components/app/card-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Reveal } from '../components/Reveal'
import { NeedsSetup } from '../components/States'
import { cn } from '@/lib/utils'
import { money, phone } from '../lib/format'
import { RISK, formatScore, riskLevel } from '../lib/risk'
import {
  cityRefusalRates,
  formatRate,
  MIN_LIST_SAMPLE,
  MIN_SAMPLE,
  productRefusalRates,
  rateOf,
  refusalTrend,
  refusalTrendSentence,
  sampleLabel,
  type NamedRate,
  type ScoredOrder,
} from '../lib/ui/analytics'
import { useIsAdmin } from '../lib/admin'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { AiError, aiJson, classifyAiThrow } from '../lib/ai'
import { softDeleteReady } from '../lib/ui/order-visibility'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'

const Map3D = lazy(() => import('../components/Map3D'))

type ViewMode = '2d' | '3d' | 'sim'

type DimKey =
  | 'risk_score'
  | 'total_orders'
  | 'total_accepted'
  | 'total_refused'
  | 'refusal_rate'
  | 'spend'
  | 'avg_order_value'

interface DimDef {
  key: DimKey
  label: string
  format: 'score' | 'count' | 'rate' | 'money'
}

const DIMS: DimDef[] = [
  { key: 'risk_score', label: 'Risk score', format: 'score' },
  { key: 'total_orders', label: 'Number of orders', format: 'count' },
  { key: 'total_accepted', label: 'Accepted orders', format: 'count' },
  { key: 'total_refused', label: 'Refused orders', format: 'count' },
  { key: 'refusal_rate', label: 'Refusal rate', format: 'rate' },
  { key: 'spend', label: 'Total spend', format: 'money' },
  { key: 'avg_order_value', label: 'Avg order value', format: 'money' },
]

/* Axis titles are drawn inside the plot, so they can never be clipped. */
const AXIS_LABEL = { fill: 'var(--ink-3)', fontSize: 11 }
const TICK_STYLE = { fill: 'var(--ink-3)', fontSize: 11 }
const GRID_STROKE = 'var(--line-2)'
const CURSOR_STROKE = 'color-mix(in srgb, var(--teal) 40%, transparent)'

interface BuyerRow {
  phone: string
  risk_score: number
  total_orders: number
  total_accepted: number
  total_refused: number
}

interface OrderLite {
  buyer_phone: string
  price: number | null
  quantity: number | null
  city: string | null
  product_name: string | null
  product_category: string | null
  ordered_at: string | null
  outcomes: { status: string | null } | null
}

interface MapPoint {
  phone: string
  risk: number
  bucket: ReturnType<typeof riskLevel>
  orders: number
  accepted: number
  refused: number
  refusalRate: number
  spend: number
  avgOrderValue: number
  x: number
  y: number
  z: number
  radius: number
}

function fmtTick(format: DimDef['format'], v: number): string {
  if (format === 'money') return v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))
  if (format === 'rate') return `${Math.round(v)}%`
  if (format === 'score') return Number(v).toFixed(1)
  return String(Math.round(v))
}

function dimDomain(format: DimDef['format']): [number, number | ((dataMax: number) => number)] {
  if (format === 'score') return [0, 1]
  if (format === 'rate') return [0, 100]
  return [0, (max: number) => Math.max(1, Math.ceil(max * 1.08))]
}

function MapTooltip({ active, payload }: { active?: boolean; payload?: { payload: MapPoint }[] }) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-[10px] border border-border bg-popover px-3 py-2 shadow-2">
      <div className="font-mono text-[12.5px] font-medium text-foreground">{phone(p.phone)}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: RISK[p.bucket].color }} aria-hidden="true" />
        {RISK[p.bucket].label} · risk {formatScore(p.risk)}
      </div>
      <div className="text-[12px] text-muted-foreground">
        {p.orders} order{p.orders === 1 ? '' : 's'} · {p.refused} refused
      </div>
      <div className="text-[12px] text-muted-foreground">
        Spend {money(p.spend)} · avg {money(p.avgOrderValue)}
      </div>
    </div>
  )
}

/** A plain labelled select, used for the axis pickers. */
function AxisSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: DimKey
  onChange: (v: DimKey) => void
}) {
  return (
    <label className="flex min-w-40 flex-col gap-1.5" htmlFor={id}>
      <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as DimKey)}
        className="h-11 rounded-[10px] border border-input bg-card px-3 text-[14px] text-foreground transition-colors hover:border-line-2 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)] md:h-9"
      >
        {DIMS.map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** The risk legend, so the colour on every dot always has its word beside it. */
function RiskLegend() {
  const tones: (keyof typeof RISK)[] = ['safe', 'watch', 'high', 'unknown']
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1.5 p-0">
      {tones.map((k) => (
        <li key={k} className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <span className="size-2.5 rounded-full" style={{ background: RISK[k].color }} aria-hidden="true" />
          {RISK[k].label}
        </li>
      ))}
      <li className="text-[12.5px] text-muted-foreground">dot size = order volume</li>
    </ul>
  )
}

/** One refusal-rate row: name, rate, and the sample it came from. */
function RateRow({ g, what }: { g: NamedRate; what: 'city' | 'product' }) {
  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[14px] font-medium text-foreground">{g.name}</span>
        <span className="shrink-0 font-mono text-[14px] font-semibold tabular-nums text-foreground">
          {formatRate(g.rate)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn(
            'h-full rounded-full',
            (g.rate ?? 0) >= 0.5 ? 'bg-risk-high' : (g.rate ?? 0) >= 0.3 ? 'bg-risk-watch' : 'bg-risk-safe',
          )}
          style={{ width: `${Math.max(2, Math.round((g.rate ?? 0) * 100))}%` }}
        />
      </div>
      <p className="text-[12px] text-muted-foreground">
        {g.refused} refused of {sampleLabel(g)} · {money(g.value ?? 0)} ordered
        {what === 'city' ? ' from this city' : ' of this product'}
      </p>
      {/* Published from a small sample: say so beside the number rather than
          hiding the whole ranking, which is what an empty list did before. */}
      {!g.confident && (
        <p className="text-[11.5px] text-risk-watch-strong">
          Small sample — treat this rate as a hint, not a figure.
        </p>
      )}
    </li>
  )
}

export function BuyerMap() {
  const navigate = useNavigate()
  const toast = useToast()
  const { store: scope } = useStoreScope()
  const { admin } = useIsAdmin()
  const [buyers, setBuyers] = useState<BuyerRow[]>([])
  const [orders, setOrders] = useState<OrderLite[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [mode, setMode] = useState<ViewMode>('2d')
  const [xKey, setXKey] = useState<DimKey>('total_orders')
  const [yKey, setYKey] = useState<DimKey>('risk_score')
  const [zKey, setZKey] = useState<DimKey>('spend')
  const [autoRotate, setAutoRotate] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [simPoints, setSimPoints] = useState<MapPoint3D[] | null>(null)
  const [simLoading, setSimLoading] = useState(false)
  const [simMeta, setSimMeta] = useState<{ embedded: number; total: number } | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    setLoadError(false)

    // One read of the orders in scope feeds both the map (spend per buyer) and
    // the refusal insights below it. Only the columns those two need.
    let ordersQuery = supabase
      .from('orders')
      .select('buyer_phone, price, quantity, city, product_name, product_category, ordered_at, outcomes(status)')
      .order('ordered_at', { ascending: false })
      .limit(2000)
    // Refusal insights are a product surface, so hidden orders stay out of them.
    if (await softDeleteReady()) ordersQuery = ordersQuery.is('deleted_at', null)
    if (scope) ordersQuery = ordersQuery.eq('store_id', scope.id)
    const ordersRes = await ordersQuery

    if (ordersRes.error) {
      setLoadError(true)
      setOrders([])
      setBuyers([])
      setLoading(false)
      return
    }

    const rows = (ordersRes.data ?? []) as unknown as OrderLite[]
    setOrders(rows)

    const scopedPhones = new Set<string>()
    for (const o of rows) scopedPhones.add(String(o.buyer_phone))

    // PRIVACY: this used to fetch EVERY buyer row on the network and filter
    // them in the browser. The filter is now in the query, so the network's
    // buyer list never leaves the database. Under the buyers policy this read
    // is also confined to the merchant's own buyers.
    let nextBuyers: BuyerRow[] = []
    if (!scope) {
      const { data, error } = await supabase
        .from('buyers')
        .select('phone, risk_score, total_orders, total_accepted, total_refused')
      if (error) setLoadError(true)
      nextBuyers = (data ?? []) as unknown as BuyerRow[]
    } else if (scopedPhones.size > 0) {
      const { data, error } = await supabase
        .from('buyers')
        .select('phone, risk_score, total_orders, total_accepted, total_refused')
        .in('phone', [...scopedPhones].slice(0, 1000))
      if (error) setLoadError(true)
      nextBuyers = (data ?? []) as unknown as BuyerRow[]
    }
    setBuyers(nextBuyers)
    setLoading(false)
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  const loadSim = useCallback(async () => {
    if (!functionsBaseUrl()) {
      toast.push({ kind: 'error', title: 'Vectors unavailable', detail: 'Edge functions are not configured.' })
      return
    }
    setSimLoading(true)
    try {
      const j = await aiJson<{
        points?: MapPoint3D[]
        embedded?: number
        total?: number
        failed?: string[]
      }>('embed_map')
      if (!j.points) throw new AiError({ kind: 'server', title: 'Could not build the vector map' })
      setSimPoints(j.points)
      setSimMeta({ embedded: j.embedded ?? j.points.length, total: j.total ?? j.points.length })
      if (j.failed && j.failed.length > 0) {
        toast.push({
          kind: 'info',
          title: 'Some buyers skipped',
          detail: `${j.failed.length} buyer(s) could not be embedded and are not shown.`,
        })
      }
    } catch (err) {
      const failure = classifyAiThrow(err)
      toast.push({ kind: 'error', title: 'Vector map failed', detail: failure.detail })
      setSimPoints([])
      setSimMeta(null)
    } finally {
      setSimLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (mode === 'sim' && simPoints === null && !simLoading) void loadSim()
  }, [mode, simPoints, simLoading, loadSim])

  const xDim = DIMS.find((d) => d.key === xKey) ?? DIMS[0]
  const yDim = DIMS.find((d) => d.key === yKey) ?? DIMS[1]
  const zDim = DIMS.find((d) => d.key === zKey) ?? DIMS[2]

  /** Spend per buyer, from the orders already loaded. */
  const spendMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const o of orders) {
      if (o.price == null) continue
      const p = String(o.buyer_phone)
      m.set(p, (m.get(p) ?? 0) + Number(o.price) * (o.quantity ?? 1))
    }
    return m
  }, [orders])

  const points = useMemo<MapPoint[]>(() => {
    return buyers
      .map((b) => {
        const ordersCount = Number(b.total_orders) || 0
        const accepted = Number(b.total_accepted) || 0
        const refused = Number(b.total_refused) || 0
        const spend = spendMap.get(b.phone) ?? 0
        const risk = Number(b.risk_score)
        const v: Record<DimKey, number> = {
          risk_score: risk,
          total_orders: ordersCount,
          total_accepted: accepted,
          total_refused: refused,
          refusal_rate: ordersCount > 0 ? (refused / ordersCount) * 100 : 0,
          spend,
          avg_order_value: ordersCount > 0 ? spend / ordersCount : 0,
        }
        return {
          phone: b.phone,
          risk,
          bucket: riskLevel(risk),
          orders: ordersCount,
          accepted,
          refused,
          refusalRate: v.refusal_rate,
          spend,
          avgOrderValue: v.avg_order_value,
          x: v[xKey],
          y: v[yKey],
          z: v[zKey],
          radius: 5 + Math.min(18, Math.round(Math.sqrt(ordersCount) * 2.6)),
        }
      })
      .sort((a, b) => b.orders - a.orders)
  }, [buyers, spendMap, xKey, yKey, zKey])

  const points3d = useMemo(() => {
    const norm = (vals: number[]) => {
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const span = max - min || 1
      return vals.map((v) => 0.08 + ((v - min) / span) * 0.84)
    }
    const xs = norm(points.map((p) => p.x))
    const ys = norm(points.map((p) => p.y))
    const zs = norm(points.map((p) => p.z))
    return points.map((p, i) => ({
      phone: p.phone,
      risk: p.risk,
      orders: p.orders,
      refused: p.refused,
      spend: p.spend,
      avgOrderValue: p.avgOrderValue,
      x: xs[i],
      y: ys[i],
      z: zs[i],
      radius: 0.02 + Math.min(0.03, Math.sqrt(p.orders) * 0.004),
    }))
  }, [points])

  const withOrders = points.filter((p) => p.orders > 0).length

  /* ── RTO / refusal insights, from the same orders the map is drawn from ── */
  const scored = useMemo<ScoredOrder[]>(
    () =>
      orders.map((o, i) => {
        const raw = o.outcomes?.status
        return {
          id: String(i),
          city: o.city,
          product_name: o.product_name,
          product_category: o.product_category,
          price: o.price,
          quantity: o.quantity,
          ordered_at: o.ordered_at,
          outcome: raw === 'accepted' || raw === 'refused' ? raw : 'pending',
        }
      }),
    [orders],
  )

  const overall = useMemo(() => rateOf(scored), [scored])
  const cities = useMemo(() => cityRefusalRates(scored, 5), [scored])
  const products = useMemo(() => productRefusalRates(scored, 5), [scored])
  const trend = useMemo(() => refusalTrend(scored, 30), [scored])
  const trendSentence = refusalTrendSentence(trend)

  const lostToRefusals = useMemo(() => {
    let sum = 0
    let any = false
    for (const o of scored) {
      if (o.outcome !== 'refused' || o.price == null) continue
      any = true
      sum += Number(o.price) * (o.quantity ?? 1)
    }
    return any ? sum : null
  }, [scored])

  if (!isConfigured || !supabase) return <NeedsSetup />

  const modeOptions: { value: ViewMode; label: string }[] = [
    { value: '2d', label: '2D scatter' },
    { value: '3d', label: '3D cloud' },
    { value: 'sim', label: 'AI similarity' },
  ]

  const rtoStats: StatItem[] = [
    {
      label: 'Refusal rate',
      value: formatRate(overall.rate),
      hint:
        overall.resolved === 0
          ? 'Nothing resolved yet'
          : `${overall.refused} refused of ${overall.resolved} resolved`,
    },
    { label: 'Resolved orders', value: overall.resolved.toLocaleString('en-PK') },
    { label: 'Still unresolved', value: overall.unknown.toLocaleString('en-PK') },
    {
      label: 'Value refused',
      value: lostToRefusals == null ? '—' : money(lostToRefusals),
      hint: lostToRefusals == null ? 'No priced refusals recorded' : 'Order value with a refusal recorded',
    },
  ]

  return (
    <PageShell>
      <PageHeader
        title="RTO insights"
        description={
          scope
            ? `Who refuses, where and on what — for ${scope.name}. Every rate shows its sample size.`
            : 'Who refuses, where and on what — across your stores. Every rate shows its sample size.'
        }
        actions={
          <Segmented ariaLabel="Map view" value={mode} onChange={setMode} options={modeOptions} />
        }
      />

      {/*
        * Internal scoring documentation. A merchant does not need Verafo's
        * threshold arithmetic or signal weights — it invites them to second-guess
        * a score they cannot change, and it reads as a spec leak. Administrators
        * keep it because it explains why a store's numbers look the way they do.
        */}
      {admin && (
        <Card className="gap-0 p-5">
          <h2 className="text-[15px] font-semibold text-foreground">How a buyer is scored</h2>
          <p className="mt-1.5 max-w-3xl text-[13.5px] text-muted-foreground">
            Verafo scores buyers with a fixed rule evaluated in the database — there is nothing to configure here.
            Below {MIN_LIST_SAMPLE} resolved orders a group is not shown as a rate at all, and an unscored buyer is
            always UNKNOWN, never safe.
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-[13.5px] text-foreground">
            <li className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">Thresholds</span>
              <span className="text-muted-foreground">
                below 0.45 LOW RISK · 0.45–0.65 MEDIUM RISK · above 0.65 HIGH RISK
              </span>
            </li>
            <li className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold">Signals</span>
              <span className="text-muted-foreground">
                refusal rate pulled toward 0.50 until 3+ resolved orders · new address +0.05 · phone first seen today
                +0.05 · 5+ accepted across 2+ stores −0.20
              </span>
            </li>
          </ul>
        </Card>
      )}

      {/* ── The map ── */}
      <Card className="gap-0 overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>
            {mode === 'sim' ? 'Similarity cloud' : mode === '3d' ? 'Buyers in three dimensions' : 'Buyers in two dimensions'}
          </CardTitle>
          <CardDescription>
            {mode === 'sim'
              ? 'Buyers positioned by their AI embedding vectors (PCA of the 1536-d fingerprint). Closer dots are more similar buyers.'
              : 'Every buyer plotted across the dimensions you choose. Click a dot to open that buyer’s profile.'}
          </CardDescription>
        </CardHeader>

        <div className="flex flex-col gap-4 border-b border-border p-5">
          {mode === 'sim' ? (
            <p className="text-[13px] text-muted-foreground">
              Resemblance is not a risk verdict, and it is never evidence of fraud.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <AxisSelect id="map-x-axis" label="X axis" value={xKey} onChange={setXKey} />
              <Button
                variant="outline"
                size="icon"
                className="size-11 md:size-9"
                title="Swap X and Y"
                aria-label="Swap X and Y axes"
                onClick={() => {
                  setXKey(yKey)
                  setYKey(xKey)
                }}
              >
                <RotateCcw className="size-4" />
              </Button>
              <AxisSelect id="map-y-axis" label="Y axis" value={yKey} onChange={setYKey} />
              {mode === '3d' && (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-11 md:size-9"
                    title="Swap X and Z"
                    aria-label="Swap X and Z axes"
                    onClick={() => {
                      setXKey(zKey)
                      setZKey(xKey)
                    }}
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                  <AxisSelect id="map-z-axis" label="Z axis" value={zKey} onChange={setZKey} />
                </>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <RiskLegend />
            {(mode === '3d' || mode === 'sim') && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 px-3 md:h-9"
                  aria-pressed={autoRotate}
                  onClick={() => setAutoRotate((a) => !a)}
                >
                  <RotateCcw className={cn('size-3.5', autoRotate && 'text-primary-text')} /> Auto-rotate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 px-3 md:h-9"
                  onClick={() => setResetKey((k) => k + 1)}
                >
                  Reset view
                </Button>
                {mode === 'sim' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 px-3 md:h-9"
                    disabled={simLoading}
                    onClick={() => {
                      setSimPoints(null)
                      void loadSim()
                    }}
                  >
                    <Sparkles className="size-3.5" /> Rebuild vectors
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <CardState
          loading={loading}
          error={loadError}
          onRetry={() => void load()}
          empty={!loading && !loadError && points.length === 0}
          emptyText="No buyers to plot yet. Buyers appear here once their first order is logged."
          skeletonHeight={420}
        >
          {mode === 'sim' ? (
            simLoading ? (
              <div className="p-10 text-center text-[13.5px] text-muted-foreground">
                Computing AI vectors… the first run embeds every buyer, then this is instant.
              </div>
            ) : simPoints === null || simPoints.length === 0 ? (
              <div className="flex flex-col items-center gap-3 p-10 text-center">
                <p className="text-[14px] font-semibold text-foreground">No vectors to show</p>
                <p className="max-w-md text-[13.5px] text-muted-foreground">
                  Buyers could not be embedded. Try “Rebuild vectors”, or check that the verafo-ai edge function is
                  deployed.
                </p>
              </div>
            ) : (
              <Suspense
                fallback={<div className="p-10 text-center text-[13.5px] text-muted-foreground">Loading similarity cloud…</div>}
              >
                <Map3D
                  points={simPoints}
                  xLabel="Similarity"
                  yLabel="Similarity"
                  zLabel="Similarity"
                  autoRotate={autoRotate}
                  resetKey={resetKey}
                  axes={false}
                />
              </Suspense>
            )
          ) : mode === '2d' ? (
            <div className="p-3">
              <ResponsiveContainer width="100%" height={480}>
                <ScatterChart margin={{ top: 12, right: 18, left: 6, bottom: 8 }}>
                  <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name={xDim.label}
                    tick={TICK_STYLE}
                    domain={dimDomain(xDim.format)}
                    tickFormatter={(v) => fmtTick(xDim.format, Number(v))}
                    label={{ value: xDim.label, position: 'insideBottom', offset: -2, ...AXIS_LABEL }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={yDim.label}
                    tick={TICK_STYLE}
                    width={52}
                    domain={dimDomain(yDim.format)}
                    tickFormatter={(v) => fmtTick(yDim.format, Number(v))}
                    label={{ value: yDim.label, angle: -90, position: 'insideLeft', ...AXIS_LABEL }}
                  />
                  <Tooltip content={<MapTooltip />} cursor={{ stroke: CURSOR_STROKE, strokeDasharray: '4 4' }} />
                  <Scatter
                    data={points}
                    onClick={(data) => {
                      const raw = data as unknown as { payload?: { phone?: string } } | { phone?: string }
                      const phone =
                        'payload' in raw
                          ? (raw as { payload?: { phone?: string } }).payload?.phone
                          : (raw as { phone?: string }).phone
                      if (phone) navigate(`/lookup?phone=${encodeURIComponent(phone)}`)
                    }}
                  >
                    {points.map((p, i) => (
                      <Cell key={i} fill={RISK[p.bucket].color} fillOpacity={0.75} style={{ cursor: 'pointer' }} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Suspense fallback={<div className="p-10 text-center text-[13.5px] text-muted-foreground">Loading 3D view…</div>}>
              <Map3D
                points={points3d}
                xLabel={xDim.label}
                yLabel={yDim.label}
                zLabel={zDim.label}
                autoRotate={autoRotate}
                resetKey={resetKey}
              />
            </Suspense>
          )}
        </CardState>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className="text-[12.5px] text-muted-foreground">
            {points.length.toLocaleString('en-PK')} buyers · {withOrders.toLocaleString('en-PK')} with orders
            {mode === 'sim'
              ? simMeta
                ? ` · ${simMeta.embedded} of ${simMeta.total} embedded`
                : ''
              : ` · X: ${xDim.label} · Y: ${yDim.label}${mode === '3d' ? ` · Z: ${zDim.label}` : ''}`}
          </p>
          <p className="text-[12.5px] text-muted-foreground">
            {mode === '2d'
              ? 'Click any dot to open the buyer’s full profile.'
              : 'Drag to rotate, scroll to zoom.'}
          </p>
        </div>
      </Card>

      {/* ── Refusal insights ── */}
      <section aria-label="Refusal insights" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold text-foreground">Where returns come from</h2>
          <p className="text-[12px] text-muted-foreground">
            From your latest {scored.length.toLocaleString('en-PK')} orders. City and product rates publish from{' '}
            {MIN_LIST_SAMPLE} resolved orders; anything under {MIN_SAMPLE} is marked as a small sample.
          </p>
        </div>

        <StatStrip items={rtoStats} loading={loading} />

        {trendSentence && (
          <Card className="gap-0 p-5">
            <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Refusal rate, last 30 days
            </p>
            <p className="mt-2 font-mono text-[26px] leading-none font-semibold tabular-nums text-foreground">
              {formatRate(trend?.current.rate ?? null)}
            </p>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              {trend ? `${trend.current.resolved} resolved · ${trend.current.unknown} still unknown` : ''}
            </p>
            <p className="mt-3 text-[13.5px] text-foreground">{trendSentence}</p>
          </Card>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="gap-0">
            <CardHeader>
              <CardTitle>Cities that refuse most</CardTitle>
              <CardDescription>Ranked by refusal rate, worst first.</CardDescription>
            </CardHeader>
            <CardContent>
              <CardState
                loading={loading}
                error={loadError}
                onRetry={() => void load()}
                empty={cities.length === 0}
                emptyText={`No city has ${MIN_LIST_SAMPLE} resolved orders yet, so no rate is published.`}
                skeletonHeight={220}
              >
                <ul className="m-0 list-none divide-y divide-border p-0">
                  {cities.map((c) => (
                    <RateRow key={c.name} g={c} what="city" />
                  ))}
                </ul>
              </CardState>
            </CardContent>
          </Card>

          <Card className="gap-0">
            <CardHeader>
              <CardTitle>Products that refuse most</CardTitle>
              <CardDescription>Ranked by refusal rate, worst first.</CardDescription>
            </CardHeader>
            <CardContent>
              <CardState
                loading={loading}
                error={loadError}
                onRetry={() => void load()}
                empty={products.length === 0}
                emptyText={`No product has ${MIN_LIST_SAMPLE} resolved orders yet, so no rate is published.`}
                skeletonHeight={220}
              >
                <ul className="m-0 list-none divide-y divide-border p-0">
                  {products.map((p) => (
                    <RateRow key={p.name} g={p} what="product" />
                  ))}
                </ul>
              </CardState>
            </CardContent>
          </Card>
        </div>

        <Reveal className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" className="h-11">
            <Link to="/orders">
              Review every order <ArrowRight className="size-4" />
            </Link>
          </Button>
          <p className="text-[12.5px] text-muted-foreground">
            Refusal rates describe what already happened. Verafo does not predict what a buyer will do.
          </p>
        </Reveal>
      </section>
    </PageShell>
  )
}
