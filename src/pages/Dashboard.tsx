import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Badge } from '../components/primitives/Badge'
import { Card } from '../components/primitives/Card'
import { Skeleton } from '../components/primitives/Skeleton'
import { DistributionBar } from '../components/charts/DistributionBar'
import { CityStatsList } from '../components/charts/CityStatsList'
import { TopProductsList } from '../components/charts/TopProductsList'
import { GeoMap } from '../components/charts/GeoMap'
import { LineChart } from '../components/charts/LineChart'
import { CountUpNumber } from '../components/CountUpNumber'
import { Sparkline } from '../components/Sparkline'
import { Reveal } from '../components/Reveal'
import { RangeFilter, type RangeDays } from '../components/RangeFilter'
import { NeedsSetup } from '../components/States'
import { phone, timeAgo } from '../lib/format'
import { greetingForName } from '../lib/greeting'
import { getProfile } from '../lib/profile'
import { hasEnoughData, toneFromScore } from '../lib/risk'
import { isConfigured, supabase } from '../lib/supabase'
import { computeCityStats, computeDailySales, computeTopProducts } from '../lib/storeStats'
import { useToast } from '../lib/toast'
import type { DailySalesRow, NetworkKpis, OrderRow } from '../lib/types'

interface BuyerLight {
  risk_score: number
  total_orders: number
}

function keyOf(d: Date): string {
  return d.toDateString()
}

export function Dashboard() {
  const toast = useToast()
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [buyers, setBuyers] = useState<BuyerLight[]>([])
  const [sales, setSales] = useState<DailySalesRow[]>([])
  const [kpis, setKpis] = useState<NetworkKpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeDays>(7)

  const load = useCallback(async () => {
    if (!supabase) return
    const [ordersRes, buyersRes, salesRes, kpisRes] = await Promise.all([
      supabase
        .from('orders')
        .select('*, stores(name), outcomes(status, resolved_at)')
        .order('ordered_at', { ascending: false })
        .limit(500),
      supabase.from('buyers').select('risk_score, total_orders').limit(5000),
      supabase.rpc('daily_sales', { p_days: range }),
      supabase.rpc('network_kpis'),
    ])
    const ordersData = (ordersRes.data ?? []) as OrderRow[]

    if (ordersRes.error) {
      toast.push({ kind: 'error', title: 'Could not load orders', detail: ordersRes.error.message })
    } else {
      setOrders(ordersData)
    }
    if (buyersRes.error) {
      toast.push({ kind: 'error', title: 'Could not load buyers', detail: buyersRes.error.message })
    } else {
      setBuyers((buyersRes.data ?? []) as BuyerLight[])
    }
    if (salesRes.error) {
      if (!ordersRes.error) {
        setSales(computeDailySales(ordersData, range))
      } else {
        toast.push({ kind: 'error', title: 'Could not load daily sales', detail: salesRes.error.message })
      }
    } else {
      setSales((salesRes.data ?? []) as DailySalesRow[])
    }
    if (kpisRes.error) {
      // KPI RPC unavailable — the client-side `stats` memo falls back to loaded data.
    } else {
      setKpis((kpisRes.data?.[0] ?? null) as NetworkKpis | null)
    }
    setLoading(false)
  }, [toast, range])

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    const now = new Date()
    const today = keyOf(now)
    const yesterday = keyOf(new Date(now.getTime() - 86400000))

    let todayOrders = 0
    let todayRevenue = 0
    let yOrders = 0
    let yRevenue = 0
    for (const o of orders) {
      const k = o.ordered_at ? keyOf(new Date(o.ordered_at)) : ''
      const total = (o.price ?? 0) * (o.quantity ?? 1)
      if (k === today) {
        todayOrders++
        todayRevenue += total
      } else if (k === yesterday) {
        yOrders++
        yRevenue += total
      }
    }

    const avg =
      buyers.length > 0 ? buyers.reduce((sum, b) => sum + b.risk_score, 0) / buyers.length : 0.5
    const pending = orders.filter((o) => !o.outcomes || o.outcomes.status === 'pending').length

    const days: { label: string; a: number }[] = []
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000)
      days.push({ label: d.toLocaleDateString('en-GB', { weekday: 'short' }), a: 0 })
    }
    const dayCount = new Map<string, number>()
    for (const o of orders) {
      if (!o.ordered_at) continue
      const k = keyOf(new Date(o.ordered_at))
      dayCount.set(k, (dayCount.get(k) ?? 0) + 1)
    }
    for (let i = 0; i < range; i++) {
      const d = new Date(now.getTime() - (range - 1 - i) * 86400000)
      days[i].a = dayCount.get(keyOf(d)) ?? 0
    }

    const distribution = { safe: 0, watch: 0, high: 0, unknown: 0 }
    for (const b of buyers) {
      if (!hasEnoughData(b.total_orders)) {
        distribution.unknown++
        continue
      }
      const tone = toneFromScore(b.risk_score)
      distribution[tone]++
    }

    return {
      todayOrders,
      todayRevenue,
      yOrders,
      yRevenue,
      avg,
      pending,
      days,
      distribution,
    }
  }, [orders, buyers, range])

  const filteredOrders = useMemo(() => {
    const cutoff = new Date().getTime() - (range - 1) * 86400000
    return orders.filter((o) => !o.ordered_at || new Date(o.ordered_at).getTime() >= cutoff)
  }, [orders, range])

  const recent = filteredOrders.slice(0, 8)

  const cityStats = useMemo(() => computeCityStats(filteredOrders), [filteredOrders])
  const topProducts = useMemo(() => computeTopProducts(filteredOrders), [filteredOrders])

  const todayOrders = kpis?.today_orders ?? stats.todayOrders
  const todayRevenue = kpis?.today_revenue ?? stats.todayRevenue
  const pending = kpis?.pending_orders ?? stats.pending

  const salesData = sales.map((s) => ({
    label: new Date(s.day).toLocaleDateString('en-GB', range === 30 ? { day: 'numeric', month: 'short' } : { weekday: 'short' }),
    a: s.revenue,
  }))

  if (!isConfigured) return <NeedsSetup />

  return (
    <div className="stack">
      <Reveal className="dash-hero">
        <div className="dash-hero-row">
          <div>
            <h1 className="dash-hero-title">{greetingForName(getProfile().name)}</h1>
            <p className="dash-hero-sub">
              {loading
                ? 'Loading your network…'
                : (
                    <span>
                      <CountUpNumber value={kpis?.buyers ?? buyers.length} /> buyers across the network,{' '}
                      <CountUpNumber value={pending} /> orders awaiting a verdict.
                    </span>
                  )}
            </p>
          </div>
          <RangeFilter range={range} onChange={setRange} />
        </div>
      </Reveal>

      {loading ? (
        <div className="stack">
          <div className="kpi-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <Skeleton width="50%" height={12} />
                <Skeleton width="70%" height={22} />
                <Skeleton width="100%" height={28} />
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <Reveal stagger className="kpi-grid">
          <Card>
            <span className="kpi-label">Orders today</span>
            <strong className="kpi-value">
              <CountUpNumber value={todayOrders} />
            </strong>
            <span className={`kpi-delta${stats.todayOrders > stats.yOrders ? ' pos' : stats.todayOrders < stats.yOrders ? ' neg' : ''}`}>
              {stats.todayOrders > stats.yOrders ? 'up' : stats.todayOrders < stats.yOrders ? 'down' : 'flat'} vs yesterday ({stats.yOrders})
            </span>
            <div className="kpi-spark">
              <Sparkline data={stats.days.map((d) => d.a)} height={28} />
            </div>
          </Card>
          <Card>
            <span className="kpi-label">Revenue today</span>
            <strong className="kpi-value">
              <CountUpNumber prefix="PKR " value={todayRevenue} />
            </strong>
            <span className={`kpi-delta${stats.todayRevenue > stats.yRevenue ? ' pos' : stats.todayRevenue < stats.yRevenue ? ' neg' : ''}`}>
              {stats.todayRevenue > stats.yRevenue ? 'up' : stats.todayRevenue < stats.yRevenue ? 'down' : 'flat'} vs yesterday
            </span>
            <div className="kpi-spark">
              <Sparkline data={salesData.map((s) => s.a)} height={28} />
            </div>
          </Card>
          <Card>
            <span className="kpi-label">Avg risk score</span>
            <strong className="kpi-value">
              <CountUpNumber value={stats.avg} decimals={2} />
            </strong>
            <span className="kpi-delta">network-wide across <CountUpNumber value={buyers.length} /> buyers</span>
          </Card>
          <Card>
            <span className="kpi-label">Pending outcomes</span>
            <strong className="kpi-value">
              <CountUpNumber value={pending} />
            </strong>
            <span className="kpi-delta">
              <Link className="link" to="/orders/pending">
                mark them now
              </Link>
            </span>
          </Card>
        </Reveal>
      )}

      <section className="chart-section">
        <Reveal stagger>
        <div className="verdict-panel-head">
          <h3 className="card-title">Sales — last {range} days</h3>
          <span className="verdict-conf">gross order value · PKR</span>
        </div>
        <Card>
          {loading ? (
            <Skeleton height={220} />
          ) : (
            <LineChart data={salesData} series={[{ key: 'a', name: 'Sales' }]} height={220} begin={140} />
          )}
        </Card>
        </Reveal>
      </section>

      <Reveal stagger className="grid-12 chart-section">
        <section className="col-8">
          <Card>
            <div className="verdict-panel-head">
              <h3 className="card-title">Orders — last {range} days</h3>
              <span className="verdict-conf">per day</span>
            </div>
            {loading ? (
              <Skeleton height={280} />
            ) : (
              <LineChart data={stats.days} series={[{ key: 'a', name: 'Orders' }]} begin={300} />
            )}
          </Card>
        </section>
        <section className="col-4">
          <Card>
            <div className="verdict-panel-head">
              <h3 className="card-title">Risk distribution</h3>
              <span className="verdict-conf">all buyers</span>
            </div>
            {loading ? (
              <Skeleton height={280} />
            ) : (
              <DistributionBar distribution={stats.distribution} begin={360} />
            )}
          </Card>
        </section>
      </Reveal>

      <Reveal stagger className="grid-12 chart-section">
        <section className="col-6">
          <Card>
            <div className="verdict-panel-head">
              <h3 className="card-title">Sales by city</h3>
              <span className="verdict-conf">geographic distribution</span>
            </div>
            {loading ? (
              <Skeleton height={240} />
            ) : cityStats.length === 0 ? (
              <span className="muted">No city data yet — add a city when logging orders.</span>
            ) : (
              <>
                <GeoMap cities={cityStats} />
                <CityStatsList cities={cityStats} />
              </>
            )}
          </Card>
        </section>
        <section className="col-6">
          <Card>
            <div className="verdict-panel-head">
              <h3 className="card-title">Top products</h3>
              <span className="verdict-conf">by revenue</span>
            </div>
            {loading ? (
              <Skeleton height={240} />
            ) : (
              <TopProductsList products={topProducts} />
            )}
          </Card>
        </section>
      </Reveal>

      <section className="chart-section">
        <Reveal stagger>
        <div className="verdict-panel-head">
          <h3 className="card-title">Recent activity</h3>
          <Link className="link" to="/orders/pending">
            <Icon name="arrow-forward" size={14} /> View outcomes
          </Link>
        </div>
        <Card className="card--flush">
          {loading ? (
            <div className="stack" style={{ padding: 'var(--s-5)' }}>
              <Skeleton height={16} />
              <Skeleton height={16} />
              <Skeleton height={16} />
            </div>
          ) : recent.length === 0 ? (
            <div className="empty-state">
              <span className="muted">No orders in the network yet.</span>
            </div>
          ) : (
            <div className="activity-feed">
              {recent.map((o) => {
                const status = o.outcomes?.status ?? 'pending'
                const dot = status === 'accepted' ? 'ok' : status === 'refused' ? 'bad' : 'pending'
                const icon = status === 'accepted' ? 'check' : status === 'refused' ? 'close' : 'time'
                return (
                  <div className="timeline-item" key={o.id}>
                    <span className={`timeline-dot ${dot}`}>
                      <Icon name={icon} size={13} />
                    </span>
                    <div className="activity-body">
                      <div className="timeline-top">
                        <span className="timeline-product">
                          {o.product_name || o.product_category || 'Untitled product'}
                        </span>
                        <Badge status={status} />
                      </div>
                      <div className="timeline-meta">
                        <span>
                          <Icon name="phone-portrait" size={13} />
                          <Link className="link" to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}>
                            {phone(o.buyer_phone)}
                          </Link>
                        </span>
                        <span>
                          <Icon name="storefront" size={13} />
                          {o.stores?.name ?? 'Unknown store'}
                        </span>
                        <span>
                          <Icon name="time" size={13} />
                          {timeAgo(o.ordered_at)}
                        </span>
                      </div>
                    </div>
                    <strong className="activity-amount">
                      <CountUpNumber prefix="PKR " value={o.price ?? 0} />
                      {o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}
                    </strong>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
        </Reveal>
      </section>
    </div>
  )
}