import { cn } from '@/lib/utils'

/**
 * The four bands a buyer can be shown in, in the words the Outcomes screen
 * uses: NEUTRAL / SAFE / MEDIUM / HIGH.
 *
 * NEUTRAL is the one that matters most here. It is not a score of 0.5 and it
 * is not "safe" — it means Verafo has no idea about this buyer yet, because
 * nothing has resolved for them. A brand-new buyer is NEUTRAL and stays
 * neutral until their first order resolves, so a first-time customer is never
 * quietly presented as a known-safe one.
 */
export type BuyerBand = 'neutral' | 'safe' | 'medium' | 'high'

const MIN_SCORED = 1
/** Where trust in the words "safe/medium/high" begins. Mirrors lib/risk.ts. */
const SAFE_BELOW = 0.45
const MEDIUM_AT_OR_BELOW = 0.65

/**
 * How many band words are safe to claim for a given score. One resolved order
 * is enough to say which way it went, but not enough to call a buyer "safe" —
 * a single accepted order is not a track record, and a merchant who ships
 * against it is trusting a word Verafo has not earned yet.
 */
export function bandEvidence(
  riskScore: number | null | undefined,
  totalOrders: number | null | undefined,
): { band: BuyerBand; confident: boolean } {
  const resolved = Math.max(0, Number(totalOrders ?? 0) || 0)
  if (resolved < MIN_SCORED || riskScore == null || Number.isNaN(Number(riskScore))) {
    return { band: 'neutral', confident: false }
  }
  const score = Math.max(0, Math.min(1, Number(riskScore)))
  if (score > MEDIUM_AT_OR_BELOW) return { band: 'high', confident: resolved >= 3 }
  if (score >= SAFE_BELOW) return { band: 'medium', confident: resolved >= 3 }
  return { band: 'safe', confident: resolved >= 3 }
}

export function buyerBand(
  riskScore: number | null | undefined,
  totalOrders: number | null | undefined,
): BuyerBand {
  return bandEvidence(riskScore, totalOrders).band
}

const BAND: Record<BuyerBand, { label: string; box: string; dot: string }> = {
  neutral: {
    label: 'NEUTRAL',
    box: 'border-risk-unknown/40 bg-risk-unknown-soft text-risk-unknown-strong',
    dot: 'bg-risk-unknown',
  },
  safe: {
    label: 'SAFE',
    box: 'border-risk-safe/40 bg-risk-safe-soft text-risk-safe-strong',
    dot: 'bg-risk-safe',
  },
  medium: {
    label: 'MEDIUM',
    box: 'border-risk-watch/40 bg-risk-watch-soft text-risk-watch-strong',
    dot: 'bg-risk-watch',
  },
  high: {
    label: 'HIGH',
    box: 'border-risk-high/40 bg-risk-high-soft text-risk-high-strong',
    dot: 'bg-risk-high',
  },
}

interface RiskScoreBadgeProps {
  riskScore?: number | null
  totalOrders?: number | null
  className?: string
}

/**
 * Band + the actual score, as one badge: `● NEUTRAL —` or `● HIGH 0.82`.
 * The numeral is shown exactly as stored (two decimals) so the badge and the
 * buyer's record in Buyer Lookup always agree.
 *
 * Where the words are withheld for thin evidence, a trailing `~` marks the
 * number as provisional rather than hiding it: the merchant still gets the
 * figure, without the badge overstating how much is known about the buyer.
 */
export function RiskScoreBadge({ riskScore, totalOrders, className }: RiskScoreBadgeProps) {
  const { band, confident } = bandEvidence(riskScore, totalOrders)
  const b = BAND[band]
  const neutral = band === 'neutral'
  const score = Number(riskScore)
  const numeral = neutral || Number.isNaN(score) ? '—' : score.toFixed(2)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        b.box,
        className,
      )}
      title={
        neutral
          ? 'Verafo has no resolved order for this buyer yet — no score to show'
          : `${b.label[0]}${b.label.slice(1).toLowerCase()} risk · score ${numeral}${confident ? '' : ' (provisional — under 3 resolved orders)'}`
      }
    >
      <span className={cn('size-1.5 rounded-full', b.dot)} aria-hidden="true" />
      {b.label}
      <span className="font-mono font-medium opacity-80">
        {numeral}
        {!neutral && !confident && <span aria-hidden="true">~</span>}
      </span>
    </span>
  )
}
