import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { RangeFilter, type RangeDays } from '../components/RangeFilter'
import { Badge } from '../components/primitives/Badge'
import { Card } from '../components/primitives/Card'
import { Skeleton } from '../components/primitives/Skeleton'
import { Table, type Column } from '../components/primitives/Table'
import { LineChart } from '../components/charts/LineChart'
import { EmptyState, NeedsSetup } from '../components/States'
import { useIsAdmin } from '../lib/admin'
import { dateTime, phone } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { computeDailySales, computeStoreOverview } from '../lib/storeStats'
import { useToast } from '../lib/toast'
import type { DailySalesRow, OrderRow, StoreOverview } from '../lib/types'

function keyOf(d: Date): string {
  return d.toDateString()
}

export function StoreDashboard() {
  const toast = useToast()
  const { id } = useParams<{ id: string }>()
  const { store, setStore } = useStoreScope()
  const { admin, checking } = useIsAdmin()

  const [overview, setOverview] = useState<StoreOverview | null>(null)
  const [sales, setSales] = useState<DailySalesRow[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeDays>(7)

  const load = useCallback(async () => {
    if (!supabase || !id) return
    const cutoff = new Date(Date.now() - (range - 1) * 86400000)
    cutoff.setHours(0, 0, 0, 0)
    const [overviewRes, salesRes, ordersRes, storeRes] = await Promise.all([
      supabase.rpc('store_overview'),
      supabase.rpc('daily_sales', { p_store_id: id, p_days: range }),
      supabase
        .from('orders')
        .select('*, stores(name), outcomes(status, resolved_at)')
        .eq('store_id', id)
        .gte('ordered_at', cutoff.toISOString())
        .order('ordered_at', { ascending: false })
        .limit(50),
      supabase.from('stores').select('id, name, owner_email, created_at, shopify_domain').eq('id', id).maybeSingle(),
    ])
    const ordersData = (ordersRes.data ?? []) as OrderRow[]

    let row: StoreOverview | null = null
    if (overviewRes.error) {
      // RPC not available (function not applied / stale schema cache) — compute client-side.
      if (!ordersRes.error && storeRes.data) {
        row = computeStoreOverview(ordersData, [storeRes.data])[0] ?? null
      } else {
        toast.push({ kind: 'error', title: 'Could not load store metrics', detail: overviewRes.error.message })
      }
    } else {
      row = ((overviewRes.data ?? []) as StoreOverview[]).find((s) => s.id === id) ?? null
    }
    setOverview(row)

    const resolvedName = row?.name ?? (storeRes.data?.name as string | undefined)
    if (resolvedName && store?.id !== id) setStore({ id, name: resolvedName })

    if (salesRes.error) {
      if (!ordersRes.error) {
        setSales(computeDailySales(ordersData, range))
      } else {
        toast.push({ kind: 'error', title: 'Could not load daily sales', detail: salesRes.error.message })
      }
    } else {
      setSales((salesRes.data ?? []) as DailySalesRow[])
    }
    if (ordersRes.error) {
      toast.push({ kind: 'error', title: 'Could not load orders', detail: ordersRes.error.message })
    } else {
      setOrders(ordersData)
    }
    setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, toast, range])

  useEffect(() => {
    void load()
  }, [load])

  if (!isConfigured) return <NeedsSetup />

  const today = keyOf(new Date())
  const todaySales = sales.find((s) => keyOf(new Date(s.day)) === today)
  const todayRevenue = todaySales?.revenue ?? 0
  const todayOrders = todaySales?.orders ?? 0

  const pendingCount = orders.filter((o) => !o.outcomes || o.outcomes.status === 'pending').length

  const salesData = sales.map((s) => ({
    label: new Date(s.day).toLocaleDateString('en-GB', range === 30 ? { day: 'numeric', month: 'short' } : { weekday: 'short' }),
    a: s.revenue,
  }))

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

  const m = overview
  const missing = !loading && !m

  return (
    <div className="stack">
      <PageHeader
        icon="storefront"
        title={m ? m.name : 'Store dashboard'}
        subtitle={
          m
            ? `${m.buyers} buyers · onboarded ${m.created_at ? dateTime(m.created_at) : '—'} · ${m.orders} lifetime orders`
            : 'Loading store…'
        }
        actions={
          m ? (
            <div className="cluster">
              <RangeFilter range={range} onChange={setRange} />
              <Link className="btn btn-secondary btn-sm" to="/orders/pending">
                <Icon name="clipboard" size={14} /> Mark outcomes
              </Link>
              <Link className="btn btn-primary btn-sm" to="/orders/new">
                <Icon name="add" size={14} /> New order
              </Link>
            </div>
          ) : undefined
        }
      />

      {!checking && !admin ? (
        <div className="card">
          <EmptyState
            icon="shield-checkmark"
            title="Restricted to admins"
            detail="Only administrators can view store dashboards."
          />
          <div className="store-restricted-cta">
            <Link className="btn btn-primary" to="/">
              <Icon name="arrow-forward" size={14} /> Back to dashboard
            </Link>
          </div>
        </div>
      ) : missing ? (
        <div className="card">
          <EmptyState icon="storefront" title="Store not found" detail="This store may have been removed." />
        </div>
      ) : (
        <>
          {loading ? (
            <div className="kpi-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <Skeleton width="50%" height={12} />
                  <Skeleton width="70%" height={22} />
                </Card>
              ))}
            </div>
          ) : (
            <div className="kpi-grid">
              <Card>
                <span className="kpi-label">Sales today</span>
                <strong className="kpi-value">PKR {todayRevenue.toLocaleString('en-PK')}</strong>
                <span className="kpi-delta">gross order value</span>
              </Card>
              <Card>
                <span className="kpi-label">Orders today</span>
                <strong className="kpi-value">{todayOrders}</strong>
                <span className="kpi-delta">across this store</span>
              </Card>
              <Card>
                <span className="kpi-label">Accepted / Refused</span>
                <strong className="kpi-value">
                  {m?.accepted ?? 0} / {m?.refused ?? 0}
                </strong>
                <span className="kpi-delta">{m ? `${((m.refused / Math.max(1, m.refused + m.accepted)) * 100).toFixed(0)}% refused` : ''}</span>
              </Card>
              <Card>
                <span className="kpi-label">Avg order value</span>
                <strong className="kpi-value">PKR {(m?.avg_order_value ?? 0).toLocaleString('en-PK')}</strong>
                <span className="kpi-delta">
                  {pendingCount > 0 ? (
                    <>
                      {pendingCount} pending — <Link className="link" to="/orders/pending">resolve</Link>
                    </>
                  ) : (
                    'no pending orders'
                  )}
                </span>
              </Card>
            </div>
          )}

          <section className="chart-section">
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
          </section>

          <section className="chart-section">
            <div className="verdict-panel-head">
              <h3 className="card-title">Recent orders</h3>
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
                  rows={orders.slice(0, 8)}
                  rowKey={(o) => o.id}
                  empty={<span className="muted">No orders for this store yet.</span>}
                />
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  )
}