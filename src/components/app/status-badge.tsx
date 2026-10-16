import { cn } from '@/lib/utils'
import type { OutcomeStatus } from '@/lib/types'

/**
 * Delivery outcome of an order. Uses the same badge ramp as the risk bands, so
 * an "Accepted" pill is as legible as a "SAFE" one instead of washing out
 * against the card.
 */
const STATUS: Record<OutcomeStatus, { label: string; box: string; dot: string }> = {
  accepted: { label: 'Accepted', box: 'border-risk-safe/50 bg-risk-safe-badge-bg text-risk-safe-badge', dot: 'bg-risk-safe' },
  refused: { label: 'Refused', box: 'border-risk-high/50 bg-risk-high-badge-bg text-risk-high-badge', dot: 'bg-risk-high' },
  pending: { label: 'Pending', box: 'border-border bg-muted text-foreground/75', dot: 'bg-muted-foreground' },
}

/** Delivery outcome of an order. */
export function StatusBadge({ status, className }: { status: OutcomeStatus | null | undefined; className?: string }) {
  const s = STATUS[status ?? 'pending']
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        s.box,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}
