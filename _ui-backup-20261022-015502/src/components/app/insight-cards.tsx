import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import {
  actionForRate,
  cityRefusalRates,
  formatRate,
  hasEnoughForInsight,
  productRefusalRates,
  refusalTrend,
  refusalTrendSentence,
  sampleLabel,
  weekdayRefusalRates,
  MIN_SAMPLE,
  type NamedRate,
  type ScoredOrder,
} from '@/lib/ui/analytics'

/** The dashboard's order shape, narrowed to what the analytics engine needs. */
export interface InsightOrder {
  city?: string | null
  product_name?: string | null
  product_category?: string | null
  price?: number | null
  quantity?: number | null
  ordered_at?: string | null
  outcomes?: { status: string | null } | null
}

/**
 * Map dashboard rows onto the analytics shape.
 *
 * An order with no outcome row, or an outcome still 'pending', becomes
 * 'pending' — the engine keeps those in their own bucket and never counts
 * them as refusals.
 */
export function toScored(orders: InsightOrder[]): ScoredOrder[] {
  return orders.map((o, i) => {
    const raw = o.outcomes?.status
    const outcome = raw === 'accepted' || raw === 'refused' ? raw : 'pending'
    return {
      id: String(i),
      city: o.city,
      product_name: o.product_name,
      product_category: o.product_category,
      price: o.price,
      quantity: o.quantity,
      ordered_at: o.ordered_at,
      outcome,
    }
  })
}

function RateCard({
  eyebrow,
  title,
  group,
  rangeLabel,
  what,
  loading,
}: {
  eyebrow: string
  title: string
  group: NamedRate
  rangeLabel: string
  what: 'city' | 'product' | 'weekday'
  loading?: boolean
}) {
  return (
    <Card className="gap-0 p-5" role="group" aria-label={`${eyebrow}: ${title}`}>
      <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">{eyebrow}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="truncate text-[17px] font-semibold text-foreground">{group.name}</span>
      </div>
      <p className="mt-1 font-mono text-[26px] leading-none font-semibold tabular-nums text-foreground">
        {formatRate(group.rate)}
      </p>
      <p className="mt-1.5 text-[12.5px] text-muted-foreground">
        refused · {sampleLabel(group)} · last {rangeLabel}
      </p>

      {/* A bar when the rate is known, so the shape is readable at a glance. */}
      {group.rate != null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className={cn(
              'h-full rounded-full',
              group.rate >= 0.5 ? 'bg-risk-high' : group.rate >= 0.3 ? 'bg-risk-watch' : 'bg-risk-safe',
            )}
            style={{ width: `${Math.max(2, Math.round(group.rate * 100))}%` }}
          />
        </div>
      )}

      <p className="mt-3 text-[12.5px] text-muted-foreground">{actionForRate(group, what)}</p>
      <Link
        to="/orders"
        className="mt-3 inline-flex h-11 items-center gap-1.5 text-[12.5px] font-semibold text-primary-text hover:underline md:h-8"
      >
        See the orders <ArrowRight className="size-3.5" />
      </Link>
      {loading && <span className="sr-only">Updating</span>}
    </Card>
  )
}

interface InsightCardsProps {
  orders: InsightOrder[]
  /** The selected period, for the labels. */
  days: number
}

/**
 * Business insight cards, computed from orders the dashboard already loaded.
 *
 * Every card shows its own sample size and the period it covers, and a card
 * is hidden entirely when the data behind it is too thin — the engine will
 * not publish a rate below its minimum sample. Nothing here is invented, and
 * unknown outcomes are never counted as refusals.
 */
export function InsightCards({ orders, days }: InsightCardsProps) {
  const scored = useMemo(() => toScored(orders), [orders])
  const rangeLabel = days === 30 ? '30 days' : '7 days'

  const cities = useMemo(() => cityRefusalRates(scored, 3), [scored])
  const products = useMemo(() => productRefusalRates(scored, 3), [scored])
  const weekdays = useMemo(() => weekdayRefusalRates(scored, 7), [scored])
  const trend = useMemo(() => refusalTrend(scored, days), [scored, days])
  const trendSentence = refusalTrendSentence(trend)

  const worstCity = cities.find((c) => c.rate != null) ?? null
  const worstProduct = products.find((p) => p.rate != null) ?? null
  const worstDay = weekdays[0] ?? null

  const cards: React.ReactNode[] = []

  if (trendSentence) {
    cards.push(
      <Card key="trend" className="gap-0 p-5">
        <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
          Refusal rate trend
        </p>
        <p className="mt-2 font-mono text-[26px] leading-none font-semibold tabular-nums text-foreground">
          {formatRate(trend?.current.rate ?? null)}
        </p>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          {trend
            ? `${trend.current.resolved} resolved · ${trend.current.unknown} still unknown · last ${rangeLabel}`
            : ''}
        </p>
        <p className="mt-3 text-[13px] text-foreground">{trendSentence}</p>
        <Link
          to="/map"
          className="mt-3 inline-flex h-11 items-center gap-1.5 text-[12.5px] font-semibold text-primary-text hover:underline md:h-8"
        >
          Look closer <ArrowRight className="size-3.5" />
        </Link>
      </Card>,
    )
  }

  if (worstCity && hasEnoughForInsight(cities)) {
    cards.push(
      <RateCard
        key="city"
        eyebrow="Highest refusal city"
        title={worstCity.name}
        group={worstCity}
        rangeLabel={rangeLabel}
        what="city"
      />,
    )
  }

  if (worstProduct && hasEnoughForInsight(products)) {
    cards.push(
      <RateCard
        key="product"
        eyebrow="Highest refusal product"
        title={worstProduct.name}
        group={worstProduct}
        rangeLabel={rangeLabel}
        what="product"
      />,
    )
  }

  if (worstDay && worstDay.rate != null && worstDay.rate > 0) {
    cards.push(
      <RateCard
        key="weekday"
        eyebrow="Hardest day of the week"
        title={worstDay.name}
        group={worstDay}
        rangeLabel={rangeLabel}
        what="weekday"
      />,
    )
  }

  if (cards.length === 0) {
    return (
      <Card className="gap-0 p-6">
        <p className="text-[13.5px] text-muted-foreground">
          Not enough resolved orders yet for city, product or weekday insights. Verafo needs at least{' '}
          {MIN_SAMPLE} resolved orders in a group before it will publish a rate, so nothing here is based on a
          handful of parcels.
        </p>
      </Card>
    )
  }

  return (
    <section aria-label="Business insights" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-foreground">What the numbers say</h2>
        <p className="text-[11.5px] text-muted-foreground">
          Based on your latest {orders.length.toLocaleString('en-PK')} orders. Unknown outcomes are counted
          separately and never as refusals.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards}</div>
    </section>
  )
}
