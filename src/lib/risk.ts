/* ============================================================
   risk.ts — verdict logic. Single source of truth for how a
   buyer's data becomes a risk verdict. UI only renders what
   this module returns.
   ============================================================ */

export type VerdictTone = 'safe' | 'watch' | 'high' | 'unknown'

export interface VerdictInput {
  risk_score?: number | null
  total_orders?: number | null
  total_refused?: number | null
  total_accepted?: number | null
}

export interface Verdict {
  tone: VerdictTone
  /** Uppercase label — LOW RISK / MEDIUM RISK / HIGH RISK / INSUFFICIENT DATA */
  label: string
  /** Sentence-case label for prose contexts */
  title: string
  /** Short chip label — LOW / MED / HIGH / INSUFFICIENT */
  short: string
  /** The numeral shown large (null when there isn't enough data) */
  numeral: string
  /** 0–1 confidence. Null when the verdict is based on too little data. */
  confidence: number | null
  /** Human confidence readout, e.g. "◐ 87%" or "◔ LOW CONFIDENCE" */
  confidenceLabel: string
}

export interface RiskFactor {
  label: string
  /** 'pos' LOWERS risk · 'neg' RAISES risk · 'none' neutral */
  impact: 'pos' | 'neg' | 'none'
}

export interface FactorInput extends VerdictInput {
  first_seen?: string | null
  orders?: { address?: string | null; store_id?: string | null; ordered_at?: string | null }[]
}

/** Full-evidence landmark: from this many resolved orders the readout is confident. */
const MIN_ORDERS = 3
/** Below this, the grey "INSUFFICIENT DATA" state. Verafo scores a buyer from its first resolved order. */
const MIN_SCORED = 1

function ordersOf(input: VerdictInput): number {
  return Math.max(0, Number(input.total_orders ?? 0) || 0)
}

function refusedOf(input: VerdictInput): number {
  return Math.max(0, Number(input.total_refused ?? 0) || 0)
}

/**
 * Enough data means the buyer has been scored by Verafo: at least one resolved
 * order. Buyers with zero resolved orders stay deliberately grey.
 */
export function hasEnoughData(totalOrders: number | null | undefined): boolean {
  return ordersOf({ total_orders: totalOrders ?? 0 }) >= MIN_SCORED
}

export function confidenceFrom(orders: number): number | null {
  if (orders < MIN_ORDERS) return null
  if (orders < 10) return 0.7
  if (orders < 25) return 0.85
  return 0.95
}

/** Thresholds mirror the historical riskLevel mapping (0–1 score). */
export function toneFromScore(score: number): VerdictTone {
  if (score < 0.45) return 'safe'
  if (score <= 0.65) return 'watch'
  return 'high'
}

const TONE_META: Record<Exclude<VerdictTone, 'unknown'>, { label: string; title: string; short: string }> = {
  safe: { label: 'LOW RISK', title: 'Low risk', short: 'LOW' },
  watch: { label: 'MEDIUM RISK', title: 'Medium risk', short: 'MED' },
  high: { label: 'HIGH RISK', title: 'High risk', short: 'HIGH' },
}

export function computeVerdict(input: VerdictInput): Verdict {
  const totalOrders = ordersOf(input)
  if (!hasEnoughData(totalOrders)) {
    return {
      tone: 'unknown',
      label: 'INSUFFICIENT DATA',
      title: 'Insufficient data',
      short: 'INSUFFICIENT',
      numeral: '—',
      confidence: null,
      confidenceLabel: '◔ LOW CONFIDENCE',
    }
  }
  const score = Math.max(0, Math.min(1, Number(input.risk_score ?? 0.5)))
  const tone = toneFromScore(score)
  const meta = TONE_META[tone as Exclude<VerdictTone, 'unknown'>]
  const confidence = confidenceFrom(totalOrders)
  return {
    tone,
    label: meta.label,
    title: meta.title,
    short: meta.short,
    numeral: score.toFixed(2),
    confidence,
    confidenceLabel: confidence == null ? '◔ LOW CONFIDENCE' : `◐ ${Math.round(confidence * 100)}%`,
  }
}

/** Plain-language contributing signals with their direction of impact. */
export function riskFactors(input: FactorInput): RiskFactor[] {
  const total = ordersOf(input)
  const refused = refusedOf(input)
  const accepted = Math.max(0, Number(input.total_accepted ?? 0) || 0)

  if (total < MIN_SCORED) {
    return [
      { label: 'No orders have resolved for this buyer yet', impact: 'none' },
      { label: 'Verdict withheld until the first order resolves', impact: 'none' },
    ]
  }

  const factors: RiskFactor[] = []

  if (refused > 0) {
    factors.push({ label: `Refused ${refused} of ${total} orders`, impact: 'neg' })
  }
  if (accepted > 0) {
    factors.push({ label: `Accepted ${accepted} of ${total} orders`, impact: 'pos' })
  }

  const stores = new Set((input.orders ?? []).map((o) => o.store_id).filter(Boolean))
  if (stores.size >= 2) {
    factors.push({ label: `Active across ${stores.size} connected stores`, impact: 'pos' })
  }

  const seen = input.first_seen ? Date.now() - new Date(input.first_seen).getTime() : 0
  if (seen > 0 && seen / 86400000 >= 60) {
    factors.push({ label: 'Known to the network for 2+ months', impact: 'pos' })
  }

  const last = input.orders?.[0]
  if (last) {
    const knownAddress = (input.orders ?? []).slice(1).some((o) => o.address && o.address === last.address)
    if (last.address && !knownAddress) {
      factors.push({ label: 'New delivery address', impact: 'neg' })
    }
  }

  if (total < MIN_ORDERS) {
    factors.push({ label: `Only ${total} order${total === 1 ? '' : 's'} resolved — early signal`, impact: 'none' })
  }

  return factors.length > 0 ? factors : [{ label: 'Consistent history, no standout signals', impact: 'none' }]
}

/** Legacy numeric helpers kept for older surfaces (map, chat). */
export function formatScore(score: number | null | undefined): string {
  if (score == null || Number.isNaN(score)) return '—'
  return (Math.round(score * 100) / 100).toFixed(2)
}

export function riskLevel(score: number): Exclude<VerdictTone, 'unknown'> {
  return toneFromScore(score) as Exclude<VerdictTone, 'unknown'>
}

export const RISK = {
  safe: { label: 'Low risk', color: 'var(--v-safe)', bg: 'var(--v-safe-bg)', border: 'color-mix(in srgb, var(--v-safe) 40%, transparent)', glow: 'transparent' },
  watch: { label: 'Medium risk', color: 'var(--v-watch)', bg: 'var(--v-watch-bg)', border: 'color-mix(in srgb, var(--v-watch) 40%, transparent)', glow: 'transparent' },
  high: { label: 'High risk', color: 'var(--v-risk)', bg: 'var(--v-risk-bg)', border: 'color-mix(in srgb, var(--v-risk) 40%, transparent)', glow: 'transparent' },
  unknown: { label: 'Insufficient data', color: 'var(--v-unknown)', bg: 'var(--v-unknown-bg)', border: 'color-mix(in srgb, var(--v-unknown) 40%, transparent)', glow: 'transparent' },
} as const
