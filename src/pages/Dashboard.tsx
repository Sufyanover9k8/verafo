import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { GeoMap } from '@/components/charts/GeoMap'
import { CountUpNumber } from '@/components/CountUpNumber'
import { NeedsSetup } from '@/components/States'
import { PageHeader } from '@/components/app/page-header'
import { Segmented } from '@/components/app/segmented'
import { StatStrip, type Trend } from '@/components/app/stat-strip'
import { StatusBadge } from '@/components/app/status-badge'
import { TrendArea, TrendBars } from '@/components/app/charts'
import { VerdictBadge } from '@/components/app/verdict-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { money, phone, timeAgo } from '@/lib/format'
import { greetingForName } from '@/lib/greeting'
import { hasEnoughData, toneFromScore } from '@/lib/risk'
import { isConfigured, supabase } from '@/lib/supabase'
import { computeCityStats, computeDailySales, computeTopProducts } from '@/lib/storeStats'
import { useSession } from '@/lib/session'
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

export function Dashboard() {
  const toast = useToast()
  const { displayName } = useSession()
  const { role, store, scopeStoreIds } = useStoreScope()
  const isAdmin = role === 'admin'
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [buyers, setBuyers] = useState<BuyerLight[]>([])
  const [sales, setSales] = useState<DailySalesRow[]>([])
  const [kpis, setKpis] = useState<NetworkKpis | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<RangeDays>(7)

  const load = useCallback(async () => {
    if (!supabase) return

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
      toast.push({ kind: 'error', title: 'Could not load orders', detail: ordersRes.error.message })
    } else {
      setOrders(ordersData)
    }

    // Buyers for the risk distribution. Admin → whole network. Merchant → only
    // buyers who have ordered from their store(s).
    if (isAdmin) {
      const { data, error } = await supabase.from('buyers').select('phone, risk_score, total_orders').limit(5000)
      if (error) toast.push({ kind: 'error', title: 'Could not load buyers', detail: error.message })
      else setBuyers((data ?? []) as BuyerLight[])
    } else {
      const phones = [...new Set(ordersData.map((o) => o.buyer_phone).filter(Boolean))]
      if (phones.length === 0) {
        setBuyers([])
      } else {
        const { data, error } = await supabase
          .from('buyers')
          .select('phone, risk_score, total_orders')
          .in('phone', phones.slice(0, 1000))
        if (error) toast.push({ kind: 'error', title: 'Could not load buyers', detail: error.message })
        else setBuyers((data ?? []) as BuyerLight[])
      }
    }

    // Network RPCs are admin-only; merchants use the client-side fallbacks.
    if (isAdmin) {
      const [salesRes, kpisRes] = await Promise.all([
        supabase.rpc('daily_sales', { p_days: range }),
        supabase.rpc('network_kpis'),
      ])
      if (salesRes.error) setSales(computeDailySales(ordersData, range))
      else setSales((salesRes.data ?? []) as DailySalesRow[])
      if (!kpisRes.error) setKpis((kpisRes.data?.[0] ?? null) as NetworkKpis | null)
    } else {
      setSales(computeDailySales(ordersData, range))
      setKpis(null)
    }

    setLoading(false)
  }, [toast, range, isAdmin, store, scopeStoreIds])

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

  const riskByPhone = useMemo(() => {
    const m = new Map<string, BuyerLight>()
    for (const b of buyers) m.set(b.phone, b)
    return m
  }, [buyers])

  /** Pending orders from a buyer with enough history to already look risky —
   *  the verdict-first "deal with these first" list. */
  const attention = useMemo(() => {
    return orders
      .filter((o) => !o.outcomes || o.outcomes.status === 'pending')
      .map((o) => ({ order: o, buyer: riskByPhone.get(o.buyer_phone) }))
      .filter(
        ({ buyer }) =>
          buyer && hasEnoughData(buyer.total_orders) && toneFromScore(buyer.risk_score) !== 'safe',
      )
      .sort((a, b) => (b.buyer?.risk_score ?? 0) - (a.buyer?.risk_score ?? 0))
      .slice(0, 5)
  }, [orders, riskByPhone])

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

  const trendOf = (today: number, yesterday: number): Trend => (today > yesterday ? 'up' : today < yesterday ? 'down' : 'flat')
  const dist = stats.distribution
  const distTotal = dist.safe + dist.watch + dist.high + dist.unknown
  const distRows = [
    { key: 'safe', label: 'Low risk', n: dist.safe, bar: 'bg-success' },
    { key: 'watch', label: 'Medium risk', n: dist.watch, bar: 'bg-warning' },
    { key: 'high', label: 'High risk', n: dist.high, bar: 'bg-destructive' },
    { key: 'unknown', label: 'Not enough data', n: dist.unknown, bar: 'bg-muted-foreground/40' },
  ]

  const subtitle = loading ? (
    'Loading your numbers…'
  ) : orders.length === 0 ? (
    <span>
      Your risk model is warming up. Verafo scores every buyer from their first resolved order.{' '}
      <Link className="font-medium text-primary hover:underline" to="/orders/new">
        Log an order
      </Link>{' '}
      or{' '}
      <Link className="font-medium text-primary hover:underline" to="/import">
        import your history
      </Link>{' '}
      to begin.
    </span>
  ) : (
    <span>
      <CountUpNumber value={kpis?.buyers ?? buyers.length} /> {isAdmin ? 'buyers across the network' : 'of your buyers scored'},{' '}
      <CountUpNumber value={pending} /> order{pending === 1 ? '' : 's'} awaiting a verdict.
    </span>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={greetingForName(displayName)}
        description={subtitle}
        actions={
          <Segmented
            ariaLabel="Date range"
            value={range}
            onChange={setRange}
            options={[
              { value: 7, label: '7 days' },
              { value: 30, label: '30 days' },
            ]}
          />
        }
      />

      {loading ? (
        <Card className="p-0">
          <div className="grid grid-cols-2 divide-x lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-3 px-5 py-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-28" />
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <StatStrip
          items={[
            {
              label: 'Orders today',
              value: <CountUpNumber value={todayOrders} />,
              trend: trendOf(stats.todayOrders, stats.yOrders),
              hint: `vs yesterday (${stats.yOrders})`,
            },
            {
              label: 'Revenue today',
              value: <CountUpNumber prefix="PKR " value={todayRevenue} />,
              trend: trendOf(stats.todayRevenue, stats.yRevenue),
              hint: `vs yesterday (${money(stats.yRevenue)})`,
            },
            {
              label: 'Average risk score',
              value: <CountUpNumber value={stats.avg} decimals={2} />,
              hint: `${isAdmin ? 'Network-wide, ' : ''}${buyers.length} buyer${buyers.length === 1 ? '' : 's'}`,
            },
            {
              label: 'Pending outcomes',
              value: <CountUpNumber value={pending} />,
              hint: (
                <Link className="font-medium text-primary hover:underline" to="/orders/pending">
                  Mark them now
                </Link>
              ),
            },
          ]}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sales</CardTitle>
            <CardDescription>Gross order value per day, last {range} days.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-60 w-full" />
            ) : (
              <TrendArea
                data={salesData.map((s) => ({ label: s.label, value: s.a }))}
                format={(n) => money(n)}
                emptyText="No sales in this period yet."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Needs your attention</CardTitle>
            <CardDescription>Pending orders from buyers who already look risky.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : attention.length === 0 ? (
              <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
                <CheckCircle2 className="size-8 text-success" strokeWidth={1.5} />
                <p className="text-sm font-medium">All clear</p>
                <p className="max-w-52 text-xs text-muted-foreground">No pending order comes from a risky buyer right now.</p>
              </div>
            ) : (
              <ul className="-mx-2 m-0 list-none divide-y divide-border p-0">
                {attention.map(({ order, buyer }) => (
                  <li key={order.id}>
                    <Link
                      to={`/lookup?phone=${encodeURIComponent(order.buyer_phone)}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-[13px] font-medium">{phone(order.buyer_phone)}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {order.product_name || order.product_category || 'Order'}
                        </div>
                      </div>
                      <VerdictBadge riskScore={buyer?.risk_score} totalOrders={buyer?.total_orders} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Orders</CardTitle>
            <CardDescription>Orders placed per day, last {range} days.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-60 w-full" />
            ) : (
              <TrendBars data={stats.days.map((d) => ({ label: d.label, value: d.a }))} emptyText="No orders in this period yet." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risk distribution</CardTitle>
            <CardDescription>{isAdmin ? 'Every buyer on the network.' : 'Buyers who ordered from your store.'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <Skeleton className="h-40 w-full" />
            ) : distTotal === 0 ? (
              <p className="text-sm text-muted-foreground">No buyers scored yet.</p>
            ) : (
              <>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Risk distribution">
                  {distRows.map((r) => (
                    <div key={r.key} className={r.bar} style={{ width: `${(r.n / distTotal) * 100}%` }} />
                  ))}
                </div>
                <ul className="m-0 list-none space-y-2.5 p-0">
                  {distRows.map((r) => (
                    <li key={r.key} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span className={`size-2 rounded-full ${r.bar}`} />
                        {r.label}
                      </span>
                      <span className="tabular-nums">
                        <span className="font-medium">{r.n}</span>
                        <span className="ms-2 text-xs text-muted-foreground">{Math.round((r.n / distTotal) * 100)}%</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Sales by city</CardTitle>
            <CardDescription>Where your revenue comes from.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : cityStats.length === 0 ? (
              <p className="text-sm text-muted-foreground">No city data yet. Add a city when logging orders.</p>
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border">
                  <GeoMap cities={cityStats} height={240} />
                </div>
                <ul className="m-0 list-none space-y-3 p-0">
                  {cityStats.slice(0, 5).map((c) => (
                    <li key={c.city} className="space-y-1.5">
                      <div className="flex items-baseline justify-between text-sm">
                        <span className="font-medium">
                          {c.city}{' '}
                          <span className="ms-1 text-xs font-normal text-muted-foreground">
                            {c.orders} order{c.orders === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="text-muted-foreground tabular-nums">{money(c.revenue)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, c.share)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
            <CardDescription>By revenue, last {range} days.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No products logged yet.</p>
            ) : (
              <ol className="m-0 list-none divide-y divide-border p-0">
                {topProducts.slice(0, 7).map((p, i) => (
                  <li key={p.name} className="flex items-center gap-3 py-3">
                    <span className="w-5 text-xs font-medium text-muted-foreground tabular-nums">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.orders} order{p.orders === 1 ? '' : 's'} · {p.share}% of sales
                      </div>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{money(p.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-5">
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>The latest orders and how they ended up.</CardDescription>
          <div data-slot="card-action" className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link to="/orders/pending">
                View outcomes <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        {loading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            {isAdmin ? 'No orders in the network yet.' : 'No orders yet.'}
          </div>
        ) : (
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
                      className="font-mono text-[13px] text-primary hover:underline"
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
        )}
      </Card>
    </div>
  )
}
