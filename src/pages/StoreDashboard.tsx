import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, ClipboardList, Plus } from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Segmented } from '../components/app/segmented'
import { StatStrip, type StatItem } from '../components/app/stat-strip'
import { StatusBadge } from '../components/app/status-badge'
import { CardState } from '../components/app/card-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { GeoMap } from '../components/charts/GeoMap'
import { CityStatsList } from '../components/charts/CityStatsList'
import { TopProductsList } from '../components/charts/TopProductsList'
import { LineChart } from '../components/charts/LineChart'
import { CountUpNumber } from '../components/CountUpNumber'
import { Avatar } from '../components/Avatar'
import { EmptyState, NeedsSetup } from '../components/States'
import { useIsAdmin } from '../lib/admin'
import { dateTime, money, phone } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { computeCityStats, computeDailySales, computeStoreOverview, computeTopProducts } from '../lib/storeStats'
import { useToast } from '../lib/toast'
import type { DailySalesRow, OrderRow, OutcomeStatus, StoreOverview } from '../lib/types'
import type { RangeDays } from '../components/RangeFilter'

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

  const cityStats = useMemo(() => computeCityStats(orders), [orders])
  const topProducts = useMemo(() => computeTopProducts(orders), [orders])

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

  const m = overview
  const missing = !loading && !m

  const kpis: StatItem[] = [
    {
      label: 'Sales today',
      value: <CountUpNumber prefix="PKR " value={todayRevenue} />,
      hint: `Gross order value over the last ${range} days`,
    },
    {
      label: 'Orders today',
      value: <CountUpNumber value={todayOrders} />,
      hint: 'Placed at this store',
    },
    {
      label: 'Accepted / refused',
      value: (
        <span>
          <CountUpNumber value={m?.accepted ?? 0} /> / <CountUpNumber value={m?.refused ?? 0} />
        </span>
      ),
      hint: m ? `${((m.refused / Math.max(1, m.refused + m.accepted)) * 100).toFixed(0)}% refused` : undefined,
    },
    {
      label: 'Avg order value',
      value: <CountUpNumber prefix="PKR " value={m?.avg_order_value ?? 0} />,
      hint:
        pendingCount > 0 ? (
          <>
            <CountUpNumber value={pendingCount} /> pending —{' '}
            <Link className="font-medium text-primary-text underline-offset-4 hover:underline" to="/orders/pending">
              resolve
            </Link>
          </>
        ) : (
          'No pending orders'
        ),
    },
  ]

  return (
    <PageShell>
      <PageHeader
        title={m ? m.name : 'Store dashboard'}
        description={
          m
            ? `${m.buyers} buyers · onboarded ${m.created_at ? dateTime(m.created_at) : '—'} · ${m.orders} lifetime orders`
            : 'Loading store…'
        }
        actions={
          m ? (
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
              <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 px-3 md:h-9">
                <Link to="/orders/pending">
                  <ClipboardList className="size-4" /> Mark outcomes
                </Link>
              </Button>
              <Button asChild size="sm" className="h-11 gap-1.5 px-3 md:h-9">
                <Link to="/orders/new">
                  <Plus className="size-4" /> New order
                </Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      {!checking && !admin ? (
        <Card className="gap-0 p-6">
          <EmptyState
            icon="shield-checkmark"
            title="Restricted to admins"
            detail="Only administrators can view store dashboards."
            action={
              <Button asChild className="h-11 gap-2 rounded-full px-5">
                <Link to="/">
                  <ArrowRight className="size-4" /> Back to dashboard
                </Link>
              </Button>
            }
          />
        </Card>
      ) : missing ? (
        <Card className="gap-0 p-6">
          <EmptyState icon="storefront" title="Store not found" detail="This store may have been removed." />
        </Card>
      ) : (
        <>
          <StatStrip items={kpis} loading={loading} />

          <Card className="gap-0">
            <CardHeader>
              <CardTitle>Sales — last {range} days</CardTitle>
              <CardDescription>Gross order value per day, in PKR.</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <CardState loading skeletonHeight={220}>
                  {null}
                </CardState>
              ) : (
                <LineChart data={salesData} series={[{ key: 'a', name: 'Sales' }]} height={220} begin={140} />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="gap-0">
              <CardHeader>
                <CardTitle>Sales by city</CardTitle>
                <CardDescription>Orders for this store, last {range} days.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <CardState
                  loading={loading}
                  empty={cityStats.length === 0}
                  emptyText="No city data for this store yet."
                  skeletonHeight={240}
                >
                  {cityStats.length > 0 && (
                    <>
                      <div className="overflow-hidden rounded-[10px] border border-border">
                        <GeoMap cities={cityStats} />
                      </div>
                      <CityStatsList cities={cityStats} />
                    </>
                  )}
                </CardState>
              </CardContent>
            </Card>

            <Card className="gap-0">
              <CardHeader>
                <CardTitle>Top products</CardTitle>
                <CardDescription>By revenue for this store.</CardDescription>
              </CardHeader>
              <CardContent>
                <CardState
                  loading={loading}
                  empty={topProducts.length === 0}
                  emptyText="No products logged yet."
                  skeletonHeight={240}
                >
                  <TopProductsList products={topProducts} />
                </CardState>
              </CardContent>
            </Card>
          </div>

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-5">
              <CardTitle>Recent orders</CardTitle>
              <CardDescription>The last {Math.min(8, orders.length)} orders at this store.</CardDescription>
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
              empty={orders.length === 0}
              emptyText="No orders for this store yet."
              skeletonHeight={180}
            >
              <div className="w-full overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="ps-6">Buyer</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-end">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pe-6">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.slice(0, 8).map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="ps-6">
                          <span className="flex items-center gap-2.5">
                            <Avatar phone={o.buyer_phone} size={26} />
                            <Link
                              to={`/lookup?phone=${encodeURIComponent(o.buyer_phone)}`}
                              className="font-mono text-[13px] font-medium text-primary-text hover:underline"
                            >
                              {phone(o.buyer_phone)}
                            </Link>
                          </span>
                        </TableCell>
                        <TableCell className="max-w-56">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="truncate">{o.product_name || o.product_category || 'Untitled product'}</span>
                            {o.product_category && (
                              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">
                                {o.product_category}
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {money(o.price)}
                          {o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={(o.outcomes?.status ?? 'pending') as OutcomeStatus} />
                        </TableCell>
                        <TableCell className="pe-6 text-muted-foreground">{dateTime(o.ordered_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardState>
          </Card>
        </>
      )}
    </PageShell>
  )
}
