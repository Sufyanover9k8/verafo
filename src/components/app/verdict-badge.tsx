import { cn } from '@/lib/utils'
import { hasEnoughData, toneFromScore, type VerdictTone } from '@/lib/risk'

const TONE: Record<VerdictTone, { label: string; box: string; dot: string }> = {
  safe: { label: 'LOW RISK', box: 'border-risk-safe/40 bg-risk-safe-soft text-risk-safe-strong', dot: 'bg-risk-safe' },
  watch: { label: 'MEDIUM RISK', box: 'border-risk-watch/40 bg-risk-watch-soft text-risk-watch-strong', dot: 'bg-risk-watch' },
  high: { label: 'HIGH RISK', box: 'border-risk-high/40 bg-risk-high-soft text-risk-high-strong', dot: 'bg-risk-high' },
  unknown: { label: 'UNKNOWN', box: 'border-risk-unknown/40 bg-risk-unknown-soft text-risk-unknown-strong', dot: 'bg-risk-unknown' },
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
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
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
