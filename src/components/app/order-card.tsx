import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { VerdictBadge } from './verdict-badge'
import { StatusBadge } from './status-badge'
import { dateTime, money, phone } from '@/lib/format'
import type { OutcomeStatus } from '@/lib/types'

/**
 * The minimum an order needs to render as a card. Both the Orders table and the
 * Outcomes queue satisfy this, so they share one card instead of drifting.
 */
export interface CardOrder {
  id: string
  buyer_phone: string
  ordered_at: string | null
  price: number | null
  quantity: number | null
  product_name?: string | null
  product_category?: string | null
  city?: string | null
  order_reference?: string | null
  courier_tracking_number?: string | null
  stores?: { name: string | null } | null
  buyers?: { name?: string | null; risk_score?: number | null; total_orders?: number | null } | null
  outcomes?: {
    status?: OutcomeStatus | null
    resolved_at?: string | null
    refusal_reason?: string | null
  } | null
}

interface Props<T extends CardOrder> {
  order: T
  /** Decision controls, rendered in an always-visible footer. */
  actions?: ReactNode
  showStore?: boolean
  /** Outcomes uses "Open buyer" as well; Orders gets it for free. */
  buyerLink?: boolean
}

/**
 * One order as a card: four facts collapsed, everything on demand.
 *
 * The decision footer is a sibling of the summary button rather than a child:
 * a button cannot legally contain another button, and clicking Accept must not
 * also toggle the card.
 */
export function OrderCard<T extends CardOrder>({
  order,
  actions,
  showStore = false,
  buyerLink = true,
}: Props<T>) {
  const [expanded, setExpanded] = useState(false)
  const status = (order.outcomes?.status ?? 'pending') as OutcomeStatus
  const detail = (label: string, value: ReactNode, wide = false) => (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <dt className="m-0 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</dt>
      <dd className="m-0 mt-0.5 break-words text-[12.5px] text-foreground">{value}</dd>
    </div>
  )

  return (
    <article
      className={`flex flex-col rounded-[16px] border bg-card transition-colors ${
        expanded ? 'border-[color-mix(in_srgb,var(--teal)_40%,var(--line))]' : 'border-border hover:border-line-2'
      }`}
    >
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 rounded-t-[16px] bg-transparent p-4 text-left"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className="truncate text-[13px] font-semibold text-foreground"
              title={order.buyers?.name ? phone(order.buyer_phone) : undefined}
            >
              {order.buyers?.name?.trim() || phone(order.buyer_phone)}
            </span>
            <VerdictBadge riskScore={order.buyers?.risk_score} totalOrders={order.buyers?.total_orders} />
          </span>
          <span className="mt-1 block truncate text-[12px] text-muted-foreground">
            {dateTime(order.ordered_at)}
            {order.city ? ` · ${order.city}` : ''}
          </span>
        </span>
        <span className="flex flex-none flex-col items-end gap-1.5">
          <span className="text-[15px] font-semibold tabular-nums text-foreground">
            {money(order.price)}
            {order.quantity && order.quantity > 1 ? (
              <span className="ms-1 text-[12px] font-medium text-muted-foreground">× {order.quantity}</span>
            ) : null}
          </span>
          <StatusBadge status={status} />
        </span>
      </button>

      {status === 'pending' && (actions || buyerLink) && (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
          {buyerLink ? (
            <Link
              className="text-[12.5px] font-semibold text-primary-text hover:underline"
              to={`/lookup?phone=${encodeURIComponent(order.buyer_phone)}`}
            >
              Open buyer
            </Link>
          ) : (
            <span />
          )}
          {actions}
        </div>
      )}

      {expanded && (
        <div className="border-t border-border px-4 py-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {detail('Product', order.product_name || order.product_category || 'Untitled product', true)}
            {showStore && detail('Store', order.stores?.name ?? '—')}
            {detail('Reference', order.order_reference || '—')}
            {detail('Tracking', order.courier_tracking_number || '—')}
            {detail('Quantity', String(order.quantity ?? 1))}
            {detail('Ordered', dateTime(order.ordered_at))}
            {order.outcomes?.resolved_at && detail('Resolved', dateTime(order.outcomes.resolved_at))}
            {order.outcomes?.refusal_reason && detail('Reason', order.outcomes.refusal_reason, true)}
          </dl>
        </div>
      )}
    </article>
  )
}
