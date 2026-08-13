import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { Badge } from '../components/primitives/Badge'
import { Card } from '../components/primitives/Card'
import { Skeleton } from '../components/primitives/Skeleton'
import { Table, type Column } from '../components/primitives/Table'
import { DistributionBar } from '../components/charts/DistributionBar'
import { LineChart } from '../components/charts/LineChart'
import { NeedsSetup } from '../components/States'
import { dateTime, phone } from '../lib/format'
import { greetingForName } from '../lib/greeting'
import { useCountUp } from '../lib/countup'
import { getProfile } from '../lib/profile'
import { hasEnoughData, toneFromScore } from '../lib/risk'
import { isConfigured, supabase } from '../lib/supabase'
import { computeDailySales, computeStoreOverview, type StoreLite } from '../lib/storeStats'
import { useToast } from '../lib/toast'
import type { DailySalesRow, NetworkKpis, OrderRow, StoreOverview } from '../lib/types'

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
  const [overview, setOverview] = useState<StoreOverview[]>([])
  const [sales, setSales] = useState<DailySalesRow[]>([])
  const [kpis, setKpis] = useState<NetworkKpis | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!supabase) return
    const [ordersRes, buyersRes, storesRes, overviewRes, salesRes, kpisRes] = await Promise.all([
      supabase
        .from('orders')
        .select('*, stores(name), outcomes(status, resolved_at)')
        .order('ordered_at', { ascending: false })
        .limit(500),
      supabase.from('buyers').select('risk_score, total_orders').limit(5000),
      supabase.from('stores').select('id, name, owner_email, created_at, shopify_domain').order('name'),
      supabase.rpc('store_overview'),
      supabase.rpc('daily_sales', { p_days: 14 }),
      supabase.rpc('network_kpis'),
    ])
    const ordersData = (ordersRes.data ?? []) as OrderRow[]
    const storesData = (storesRes.data ?? []) as StoreLite[]

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
    if (storesRes.error) {
      toast.push({ kind: 'error', title: 'Could not load stores', detail: storesRes.error.message })
    }
    if (overviewRes.error) {
      // RPC not available (function not applied / stale schema cache) — compute client-side.
      if (!ordersRes.error && !storesRes.error) {
        setOverview(computeStoreOverview(ordersData, storesData))
      } else {
        toast.push({ kind: 'error', title: 'Could not load store metrics', detail: overviewRes.error.message })
      }
    } else {
      setOverview((overviewRes.data ?? []) as StoreOverview[])
    }
    if (salesRes.error) {
      if (!ordersRes.error) {
        setSales(computeDailySales(ordersData, 14))
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
  }, [toast])

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
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000)
      days.push({ label: d.toLocaleDateString('en-GB', { weekday: 'short' }), a: 0 })
    }
    const dayCount = new Map<string, number>()
    for (const o of orders) {
      if (!o.ordered_at) continue
      const k = keyOf(new Date(o.ordered_at))
      dayCount.set(k, (dayCount.get(k) ?? 0) + 1)
    }
    for (let i = 0; i < 7; i++) {
      const d = new Date(now.getTime() - (6 - i) * 86400000)
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
  }, [orders, buyers])

  const recent = orders.slice(0, 8)

  const todayOrders = useCountUp(kpis?.today_orders ?? stats.todayOrders)
  const todayRevenue = useCountUp(kpis?.today_revenue ?? stats.todayRevenue)
  const pending = useCountUp(kpis?.pending_orders ?? stats.pending)

  const storeColumns: Column<StoreOverview>[] = [
    {
      key: 'name',
      label: 'Store',
      id: true,
      render: (s) => (
        <Link className="link" to={`/stores/${s.id}`}>
          {s.name}
          {s.shopify_domain && <span className="muted"> · {s.shopify_domain}</span>}
        </Link>
      ),
    },
    { key: 'orders', label: 'Orders', num: true },
    { key: 'accepted', label: 'Accepted', num: true },
    { key: 'refused', label: 'Refused', num: true },
    { key: 'pending', label: 'Pending', num: true },
    { key: 'buyers', label: 'Buyers', num: true },
    {
      key: 'revenue',
      label: 'Sales (PKR)',
      num: true,
      render: (s) => <strong>{s.revenue.toLocaleString('en-PK')}</strong>,
    },
    {
      key: 'avg_order_value',
      label: 'Avg order',
      num: true,
      render: (s) => (s.avg_order_value || 0).toLocaleString('en-PK'),
    },
    {
      key: 'last_order_at',
      label: 'Last activity',
      render: (s) => <span className="muted">{s.last_order_at ? dateTime(s.last_order_at) : '—'}</span>,
    },
  ]

  const salesData = sales.map((s) => ({
    label: new Date(s.day).toLocaleDateString('en-GB', { weekday: 'short' }),
    a: s.revenue,
  }))

  if (!isConfigured) return <NeedsSetup />

  const columns: Column<OrderRow>[] = [
    {
      key: 'buyer',
      label: 'Buyer',
      id: true,
      render: (o) => (
        <Link className="link" to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}>
          {phone(o.buyer_phone)}
        </Link>
      ),
    },
    {
      key: 'product',
      label: 'Product',
      render: (o) => (
        <span>
          {o.product_name || o.product_category || 'Untitled product'}
          {o.product_category && <span className="chip">{o.product_category}</span>}
        </span>
      ),
    },
    {
      key: 'store',
      label: 'Store',
      render: (o) => <span className="muted">{o.stores?.name ?? 'Unknown store'}</span>,
    },
    {
      key: 'total',
      label: 'Total',
      num: true,
      render: (o) =>
        `${(o.price ?? 0).toLocaleString('en-PK')}${o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}`,
    },
    {
      key: 'status',
      label: 'Status',
      render: (o) => <Badge status={(o.outcomes?.status ?? 'pending') as 'accepted' | 'refused' | 'pending'} />,
    },
    {
      key: 'when',
      label: 'When',
      render: (o) => <span className="muted">{dateTime(o.ordered_at)}</span>,
    },
  ]

  return (
    <div className="stack">
      <div className="dash-hero">
        <h1 className="dash-hero-title">{greetingForName(getProfile().name)}</h1>
        <p className="dash-hero-sub">
          {loading
            ? 'Loading your network…'
            : `${(kpis?.buyers ?? buyers.length).toLocaleString('en-PK')} buyers across the network, ${
                (kpis?.pending_orders ?? stats.pending).toLocaleString('en-PK')
              } orders awaiting a verdict.`}
        </p>
      </div>

      {loading ? (
        <div className="stack">
          <div className="kpi-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <Skeleton width="50%" height={12} />
                <Skeleton width="70%" height={22} />
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="kpi-grid">
          <Card>
            <span className="kpi-label">Orders today</span>
            <strong className="kpi-value">{todayOrders}</strong>
            <span className={`kpi-delta${stats.todayOrders > stats.yOrders ? ' pos' : stats.todayOrders < stats.yOrders ? ' neg' : ''}`}>
              {stats.todayOrders > stats.yOrders ? 'up' : stats.todayOrders < stats.yOrders ? 'down' : 'flat'} vs yesterday ({stats.yOrders})
            </span>
          </Card>
          <Card>
            <span className="kpi-label">Revenue today</span>
            <strong className="kpi-value">PKR {todayRevenue.toLocaleString('en-PK')}</strong>
            <span className={`kpi-delta${stats.todayRevenue > stats.yRevenue ? ' pos' : stats.todayRevenue < stats.yRevenue ? ' neg' : ''}`}>
              {stats.todayRevenue > stats.yRevenue ? 'up' : stats.todayRevenue < stats.yRevenue ? 'down' : 'flat'} vs yesterday
            </span>
          </Card>
          <Card>
            <span className="kpi-label">Avg risk score</span>
            <strong className="kpi-value">{stats.avg.toFixed(2)}</strong>
            <span className="kpi-delta">network-wide across {buyers.length.toLocaleString('en-PK')} buyers</span>
          </Card>
          <Card>
            <span className="kpi-label">Pending outcomes</span>
            <strong className="kpi-value">{pending}</strong>
            <span className="kpi-delta">
              <Link className="link" to="/orders/pending">
                mark them now
              </Link>
            </span>
          </Card>
        </div>
      )}

      <section className="chart-section">
        <div className="verdict-panel-head">
          <h3 className="card-title">Sales — last 14 days</h3>
          <span className="verdict-conf">gross order value · PKR</span>
        </div>
        <Card>
          {loading ? (
            <Skeleton height={220} />
          ) : (
            <LineChart data={salesData} series={[{ key: 'a', name: 'Sales' }]} height={220} begin={140} />
          )}
        </Card>
      </section>

      <div className="grid-12 chart-section">
        <section className="col-8">
          <Card>
            <div className="verdict-panel-head">
              <h3 className="card-title">Orders — last 7 days</h3>
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
      </div>

      <section className="chart-section">
        <div className="verdict-panel-head">
          <h3 className="card-title">Onboarded stores</h3>
          <span className="verdict-conf">
            {overview.length} {overview.length === 1 ? 'store' : 'stores'} · click a row to open its dashboard
          </span>
        </div>
        <Card className="card--flush">
          {loading ? (
            <div className="stack" style={{ padding: 'var(--s-5)' }}>
              <Skeleton height={16} />
              <Skeleton height={16} />
              <Skeleton height={16} />
            </div>
          ) : (
            <Table
              columns={storeColumns}
              rows={overview}
              rowKey={(s) => s.id}
              empty={<span className="muted">No stores onboarded yet. Connect a Shopify store or add rows via supabase/seed.sql.</span>}
            />
          )}
        </Card>
      </section>

      <section className="chart-section">
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
          ) : (
            <Table
              columns={columns}
              rows={recent}
              rowKey={(o) => o.id}
              empty={<span className="muted">No orders in the network yet.</span>}
            />
          )}
        </Card>
      </section>
    </div>
  )
}