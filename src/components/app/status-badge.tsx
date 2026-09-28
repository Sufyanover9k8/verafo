import { cn } from '@/lib/utils'
import type { OutcomeStatus } from '@/lib/types'

const STATUS: Record<OutcomeStatus, { label: string; box: string; dot: string }> = {
  accepted: { label: 'Accepted', box: 'border-success/25 bg-success/10 text-success', dot: 'bg-success' },
  refused: { label: 'Refused', box: 'border-destructive/25 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  pending: { label: 'Pending', box: 'border-border bg-muted text-muted-foreground', dot: 'bg-muted-foreground/60' },
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
