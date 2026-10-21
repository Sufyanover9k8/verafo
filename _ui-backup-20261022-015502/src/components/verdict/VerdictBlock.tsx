import { cn } from '@/lib/utils'
import { computeVerdict, type VerdictInput, type VerdictTone } from '../../lib/risk'

const TONE: Record<VerdictTone, { text: string; soft: string; bar: string; dot: string }> = {
  safe: { text: 'text-risk-safe-strong', soft: 'bg-risk-safe-soft', bar: 'bg-risk-safe', dot: 'bg-risk-safe' },
  watch: { text: 'text-risk-watch-strong', soft: 'bg-risk-watch-soft', bar: 'bg-risk-watch', dot: 'bg-risk-watch' },
  high: { text: 'text-risk-high-strong', soft: 'bg-risk-high-soft', bar: 'bg-risk-high', dot: 'bg-risk-high' },
  unknown: {
    text: 'text-risk-unknown-strong',
    soft: 'bg-risk-unknown-soft',
    bar: 'bg-risk-unknown',
    dot: 'bg-risk-unknown',
  },
}

interface VerdictBlockProps extends VerdictInput {
  stores?: number
  firstSeen?: string | null
}

/**
 * The signature readout: the score as a large numeral, the verdict word beside
 * it, and one line of the counts it was computed from. The word is always
 * shown, so the colour is never the only signal.
 */
export function VerdictBlock({ stores, firstSeen, ...input }: VerdictBlockProps) {
  const verdict = computeVerdict(input)
  const orders = Math.max(0, Number(input.total_orders ?? 0) || 0)
  const accepted = Math.max(0, Number(input.total_accepted ?? 0) || 0)
  const refused = Math.max(0, Number(input.total_refused ?? 0) || 0)
  const t = TONE[verdict.tone]

  const meta: string[] = []
  if (orders > 0) meta.push(`${orders} order${orders === 1 ? '' : 's'}`)
  if (accepted > 0) meta.push(`${accepted} accepted`)
  if (refused > 0) meta.push(`${refused} refused`)
  if (stores) meta.push(`across ${stores} store${stores === 1 ? '' : 's'}`)
  if (firstSeen) {
    const d = new Date(firstSeen)
    if (!Number.isNaN(d.getTime())) {
      meta.push(`first seen ${d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`)
    }
  }

  return (
    <div className={cn('relative overflow-hidden rounded-[16px] border border-border p-5', t.soft)}>
      <span aria-hidden="true" className={cn('absolute inset-y-0 start-0 w-[3px]', t.bar)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Risk verdict</span>
        <span className="font-mono text-[12px] text-muted-foreground">{verdict.confidenceLabel}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn('font-mono text-[38px] leading-none font-bold tracking-tight tabular-nums', t.text)}>
          {verdict.numeral}
        </span>
        <span className={cn('flex items-center gap-2 text-[17px] font-semibold', t.text)}>
          <span className={cn('size-2.5 rounded-full', t.dot)} aria-hidden="true" />
          {verdict.title}
        </span>
      </div>
      {meta.length > 0 && (
        <>
          <hr className="my-3 border-border" />
          <p className="text-[12.5px] text-muted-foreground">{meta.join(' · ')}</p>
        </>
      )}
    </div>
  )
}
