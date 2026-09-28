import { cn } from '@/lib/utils'
import { hasEnoughData, toneFromScore, type VerdictTone } from '@/lib/risk'

const TONE: Record<VerdictTone, { label: string; box: string; dot: string }> = {
  safe: { label: 'Low risk', box: 'border-success/25 bg-success/10 text-success', dot: 'bg-success' },
  watch: { label: 'Medium risk', box: 'border-warning/30 bg-warning/10 text-warning', dot: 'bg-warning' },
  high: { label: 'High risk', box: 'border-destructive/25 bg-destructive/10 text-destructive', dot: 'bg-destructive' },
  unknown: { label: 'Not enough data', box: 'border-border bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
}

interface VerdictBadgeProps {
  riskScore?: number | null
  totalOrders?: number | null
  showScore?: boolean
  className?: string
}

/** The risk verdict for a buyer. Buyers with no resolved orders are deliberately grey, never green. */
export function VerdictBadge({ riskScore, totalOrders, showScore = false, className }: VerdictBadgeProps) {
  const known = riskScore != null && hasEnoughData(totalOrders)
  const tone: VerdictTone = known ? toneFromScore(riskScore) : 'unknown'
  const t = TONE[tone]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        t.box,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', t.dot)} />
      {t.label}
      {showScore && known && <span className="font-mono opacity-70">{riskScore.toFixed(2)}</span>}
    </span>
  )
}
