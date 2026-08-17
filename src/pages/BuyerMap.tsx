import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { Icon } from '../components/Icon'
import type { MapPoint3D } from '../components/Map3D'
import { PageHeader } from '../components/PageHeader'
import { Reveal } from '../components/Reveal'
import { EmptyState, NeedsSetup } from '../components/States'
import { money } from '../lib/format'
import { RISK, formatScore, riskLevel } from '../lib/score'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
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
  { key: 'total_orders', label: 'Total orders', format: 'count' },
  { key: 'total_accepted', label: 'Accepted orders', format: 'count' },
  { key: 'total_refused', label: 'Refused orders', format: 'count' },
  { key: 'refusal_rate', label: 'Refusal rate', format: 'rate' },
  { key: 'spend', label: 'Total spend', format: 'money' },
  { key: 'avg_order_value', label: 'Avg order value', format: 'money' },
]

interface BuyerRow {
  phone: string
  risk_score: number
  total_orders: number
  total_accepted: number
  total_refused: number
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

const TICK_STYLE = { fill: 'var(--muted)', fontSize: 11 }
const GRID_STROKE = 'var(--border)'
const CURSOR_STROKE = 'color-mix(in srgb, var(--accent) 40%, transparent)'

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
    <div className="map-tip">
      <div className="map-tip-phone">{p.phone}</div>
      <div className="map-tip-row">
        <span className="map-tip-dot" style={{ background: RISK[p.bucket].color }} />
        {RISK[p.bucket].label} · risk {formatScore(p.risk)}
      </div>
      <div className="map-tip-row">
        {p.orders} order{p.orders === 1 ? '' : 's'} · {p.refused} refused
      </div>
      <div className="map-tip-row">Spend {money(p.spend)} · avg {money(p.avgOrderValue)}</div>
    </div>
  )
}

export function BuyerMap() {
  const navigate = useNavigate()
  const toast = useToast()
  const { store: scope } = useStoreScope()
  const [buyers, setBuyers] = useState<BuyerRow[]>([])
  const [spendMap, setSpendMap] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
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
    let ordersQuery = supabase.from('orders').select('buyer_phone, price')
    if (scope) ordersQuery = ordersQuery.eq('store_id', scope.id)
    const [buyersRes, ordersRes] = await Promise.all([
      supabase.from('buyers').select('phone, risk_score, total_orders, total_accepted, total_refused'),
      ordersQuery,
    ])
    const scopedPhones = new Set<string>()
    const spend = new Map<string, number>()
    for (const o of ordersRes.data ?? []) {
      const p = String(o.buyer_phone)
      scopedPhones.add(p)
      if (o.price != null) {
        spend.set(p, (spend.get(p) ?? 0) + Number(o.price))
      }
    }
    setSpendMap(spend)
    const all = (buyersRes.data ?? []) as unknown as BuyerRow[]
    setBuyers(scope ? all.filter((b) => scopedPhones.has(b.phone)) : all)
    setLoading(false)
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  const loadSim = useCallback(async () => {
    const base = functionsBaseUrl()
    if (!base) {
      toast.push({ kind: 'error', title: 'Vectors unavailable', detail: 'Edge functions are not configured.' })
      return
    }
    setSimLoading(true)
    try {
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'embed_map' }),
      })
      const j = (await res.json()) as {
        points?: MapPoint3D[]
        embedded?: number
        total?: number
        failed?: string[]
        error?: string
      }
      if (!res.ok || !j.points) throw new Error(j.error ?? 'Could not build the vector map')
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
      const message = err instanceof Error ? err.message : String(err)
      toast.push({ kind: 'error', title: 'Vector map failed', detail: message })
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

  const points = useMemo<MapPoint[]>(() => {
    return buyers
      .map((b) => {
        const orders = Number(b.total_orders) || 0
        const accepted = Number(b.total_accepted) || 0
        const refused = Number(b.total_refused) || 0
        const spend = spendMap.get(b.phone) ?? 0
        const risk = Number(b.risk_score)
        const v: Record<DimKey, number> = {
          risk_score: risk,
          total_orders: orders,
          total_accepted: accepted,
          total_refused: refused,
          refusal_rate: orders > 0 ? (refused / orders) * 100 : 0,
          spend,
          avg_order_value: orders > 0 ? spend / orders : 0,
        }
        return {
          phone: b.phone,
          risk,
          bucket: riskLevel(risk),
          orders,
          accepted,
          refused,
          refusalRate: v.refusal_rate,
          spend,
          avgOrderValue: v.avg_order_value,
          x: v[xKey],
          y: v[yKey],
          z: v[zKey],
          radius: 5 + Math.min(18, Math.round(Math.sqrt(orders) * 2.6)),
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

  if (!isConfigured || !supabase) return <NeedsSetup />

  return (
    <div className="page map-page">
      <PageHeader
        title="Buyer Map"
        subtitle="Scatter every buyer across any two dimensions and spot risk clusters."
        icon="layers-outline"
      />

      <div className="map-toolbar">
        <div className="mode-switch" role="group" aria-label="View mode">
          <button
            className={mode === '2d' ? 'active' : ''}
            onClick={() => setMode('2d')}
            title="2D scatter"
          >
            2D
          </button>
          <button
            className={mode === '3d' ? 'active' : ''}
            onClick={() => setMode('3d')}
            title="3D scatter — drag to rotate, scroll to zoom"
          >
            3D
          </button>
          <button
            className={mode === 'sim' ? 'active' : ''}
            onClick={() => setMode('sim')}
            title="AI similarity — buyers positioned by their embedding vectors"
          >
            <Icon name="sparkles-outline" size={13} /> Similarity
          </button>
        </div>
      </div>

      {mode === 'sim' ? (
        <div className="map-controls map-controls-sim">
          <span className="sim-hint">
            <Icon name="sparkles-outline" size={13} />
            Buyers are positioned by their AI embedding vectors (PCA of the 1536-d fingerprint).
            Closer dots are more similar buyers.
          </span>
        </div>
      ) : (
        <div className={mode === '3d' ? 'map-controls map-controls-3d' : 'map-controls'}>
        <label className="field">
          <span className="field-label">
            <Icon name="trending-up-outline" size={13} /> X axis
          </span>
          <select value={xKey} onChange={(e) => setXKey(e.target.value as DimKey)}>
            {DIMS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        <button
          className="btn ghost map-swap"
          title="Swap axes"
          onClick={() => {
            setXKey(yKey)
            setYKey(xKey)
          }}
        >
          <Icon name="sync-outline" size={16} />
        </button>

        <label className="field">
          <span className="field-label">
            <Icon name="stats-chart-outline" size={13} /> Y axis
          </span>
          <select value={yKey} onChange={(e) => setYKey(e.target.value as DimKey)}>
            {DIMS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        {mode === '3d' && (
          <>
            <button
              className="btn ghost map-swap"
              title="Swap X and Z"
              onClick={() => {
                setXKey(zKey)
                setZKey(xKey)
              }}
            >
              <Icon name="sync-outline" size={16} />
            </button>

            <label className="field">
              <span className="field-label">
                <Icon name="layers-outline" size={13} /> Z axis
              </span>
              <select value={zKey} onChange={(e) => setZKey(e.target.value as DimKey)}>
                {DIMS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        </div>
      )}

      <Reveal className="map-stats">
        <span>
          <strong>{points.length}</strong> buyers
        </span>
        <span>
          <strong>{withOrders}</strong> with orders
        </span>
        {mode === 'sim' ? (
          <span className="map-axes-hint">
            <strong>{simMeta ? `${simMeta.embedded} of ${simMeta.total}` : '…'}</strong> embedded
            {simMeta && simMeta.embedded < simMeta.total && ' · rerun to finish'}
          </span>
        ) : (
          <span className="map-axes-hint">
            X: {xDim.label} · Y: {yDim.label}
            {mode === '3d' && <> · Z: {zDim.label}</>}
          </span>
        )}
      </Reveal>

      {loading ? (
        <EmptyState icon="hourglass-outline" title="Loading buyers…" />
      ) : points.length === 0 ? (
        <EmptyState icon="person-outline" title="No buyers yet" detail="Log some orders first — buyers appear here automatically." />
      ) : (
        <Reveal className="map-card spotlight">
          <div className="map-legend">
            {(Object.keys(RISK) as (keyof typeof RISK)[]).map((k) => (
              <span key={k} className="map-legend-item">
                <span className="map-legend-dot" style={{ background: RISK[k].color }} />
                {RISK[k].label}
              </span>
            ))}
            <span className="map-legend-item map-legend-note">dot size = order volume</span>
            {(mode === '3d' || mode === 'sim') && (
              <span className="map-legend-item map-legend-actions">
                <button
                  className={`btn ghost small ${autoRotate ? 'active' : ''}`}
                  onClick={() => setAutoRotate((a) => !a)}
                >
                  <Icon name="refresh-outline" size={13} /> auto-rotate
                </button>
                <button className="btn ghost small" onClick={() => setResetKey((k) => k + 1)}>
                  <Icon name="compass-outline" size={13} /> reset view
                </button>
                {mode === 'sim' && (
                  <button className="btn ghost small" onClick={() => { setSimPoints(null); void loadSim() }}>
                    <Icon name="sync-outline" size={13} /> rebuild vectors
                  </button>
                )}
              </span>
            )}
          </div>

          {mode === 'sim' ? (
            simLoading ? (
              <EmptyState
                icon="sparkles-outline"
                title="Computing AI vectors…"
                detail="First run embeds every buyer with an AI fingerprint (~30s), then this is instant."
              />
            ) : simPoints === null || simPoints.length === 0 ? (
              <EmptyState
                icon="sparkles-outline"
                title="No vectors to show"
                detail="Buyers could not be embedded. Try 'rebuild vectors' or check the edge function."
              />
            ) : (
              <Suspense fallback={<div className="map3d-loading">Loading similarity cloud…</div>}>
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
            <div className="map-chart">
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
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name={yDim.label}
                    tick={TICK_STYLE}
                    width={52}
                    domain={dimDomain(yDim.format)}
                    tickFormatter={(v) => fmtTick(yDim.format, Number(v))}
                  />
                  <Tooltip
                    content={<MapTooltip />}
                    cursor={{ stroke: CURSOR_STROKE, strokeDasharray: '4 4' }}
                  />
                  <Scatter
                    data={points}
                    onClick={(data) => {
                      const raw = data as unknown as { payload?: { phone?: string } } | { phone?: string }
                      const phone =
                        'payload' in raw ? (raw as { payload?: { phone?: string } }).payload?.phone : (raw as { phone?: string }).phone
                      if (phone) navigate(`/lookup?phone=${encodeURIComponent(phone)}`)
                    }}
                  >
                    {points.map((p, i) => (
                      <Cell
                        key={i}
                        fill={RISK[p.bucket].color}
                        fillOpacity={0.75}
                        style={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Suspense fallback={<div className="map3d-loading">Loading 3D view…</div>}>
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

          <div className="map-foot">
            {mode === '2d'
              ? 'Click any dot to open the buyer\u2019s full profile.'
              : mode === 'sim'
                ? 'AI similarity cloud. Drag to rotate, scroll to zoom. Closer dots = more similar buyers.'
                : 'Drag to rotate, scroll to zoom. Hover a dot for details, click\u2026'}
          </div>
        </Reveal>
      )}
    </div>
  )
}
