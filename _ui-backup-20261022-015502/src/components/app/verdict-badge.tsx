import { cn } from '@/lib/utils'

/**
 * The four bands Verafo shows a buyer in, in the words the whole app uses:
 * NEUTRAL / SAFE / MEDIUM / HIGH.
 *
 * NEUTRAL is the one that carries weight. It is not a score of 0.5 and it is
 * not "safe" — it means Verafo has no idea about this buyer yet, because
 * nothing has resolved for them. A first-time customer is NEUTRAL and stays
 * neutral until their first order resolves, so a new buyer is never quietly
 * presented as a known-safe one.
 */
export type BuyerBand = 'neutral' | 'safe' | 'medium' | 'high'

/** Below this many resolved orders, "safe"/"medium"/"high" are a guess. */
const CONFIDENT_AT = 3
/** Where trust in the words begins. Thresholds mirror lib/risk.ts. */
const SAFE_BELOW = 0.45
const MEDIUM_AT_OR_BELOW = 0.65

/**
 * The band for a buyer, plus whether there is enough history behind the word
 * to state it plainly.
 *
 * One resolved order is enough to say which way it went, but not enough to
 * call a buyer "safe": a single accepted order is not a track record, and a
 * merchant who ships against it is trusting a word Verafo has not earned yet.
 */
export function bandEvidence(
  riskScore: number | null | undefined,
  totalOrders: number | null | undefined,
): { band: BuyerBand; confident: boolean } {
  const resolved = Math.max(0, Number(totalOrders ?? 0) || 0)
  if (resolved < 1 || riskScore == null || Number.isNaN(Number(riskScore))) {
    return { band: 'neutral', confident: false }
  }
  const score = Math.max(0, Math.min(1, Number(riskScore)))
  const confident = resolved >= CONFIDENT_AT
  if (score > MEDIUM_AT_OR_BELOW) return { band: 'high', confident }
  if (score >= SAFE_BELOW) return { band: 'medium', confident }
  return { band: 'safe', confident }
}

export function buyerBand(
  riskScore: number | null | undefined,
  totalOrders: number | null | undefined,
): BuyerBand {
  return bandEvidence(riskScore, totalOrders).band
}

/**
 * Colour per band, from the dedicated badge ramp (tokens.css). Deeper type and
 * an opaque tinted fill than the general risk tokens, so a pill reads as a pill
 * against the card instead of fading into it.
 */
const BAND: Record<BuyerBand, { label: string; box: string; dot: string }> = {
  neutral: {
    label: 'NEUTRAL',
    box: 'border-risk-unknown/70 bg-risk-unknown-badge-bg text-risk-unknown-badge',
    dot: 'bg-risk-unknown',
  },
  safe: {
    label: 'SAFE',
    box: 'border-risk-safe/70 bg-risk-safe-badge-bg text-risk-safe-badge',
    dot: 'bg-risk-safe',
  },
  medium: {
    label: 'MEDIUM',
    box: 'border-risk-watch/70 bg-risk-watch-badge-bg text-risk-watch-badge',
    dot: 'bg-risk-watch',
  },
  high: {
    label: 'HIGH',
    box: 'border-risk-high/70 bg-risk-high-badge-bg text-risk-high-badge',
    dot: 'bg-risk-high',
  },
}

interface VerdictBadgeProps {
  riskScore?: number | null
  totalOrders?: number | null
  /** Kept for call sites that used to opt in; the score is always shown now. */
  showScore?: boolean
  className?: string
}

/**
 * A buyer's band with the actual score beside it: `● SAFE 0.17`.
 *
 * The numeral is shown as stored (two decimals) so the badge and the buyer's
 * record in Buyer Lookup always agree. NEUTRAL shows no number at all, because
 * there is no score to show — printing the neutral 0.5 default would invent
 * one. Where the words are withheld for thin evidence, a trailing `~` marks
 * the number as provisional rather than hiding it: the merchant still gets the
 * figure, without the badge overstating how much is known about the buyer.
 */
export function VerdictBadge({ riskScore, totalOrders, className }: VerdictBadgeProps) {
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
