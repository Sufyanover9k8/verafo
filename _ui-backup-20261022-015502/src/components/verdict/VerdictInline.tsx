import { cn } from '@/lib/utils'
import { computeVerdict, type VerdictInput, type VerdictTone } from '../../lib/risk'

const TONE: Record<VerdictTone, string> = {
  safe: 'border-risk-safe/40 bg-risk-safe-soft text-risk-safe-strong',
  watch: 'border-risk-watch/40 bg-risk-watch-soft text-risk-watch-strong',
  high: 'border-risk-high/40 bg-risk-high-soft text-risk-high-strong',
  unknown: 'border-risk-unknown/40 bg-risk-unknown-soft text-risk-unknown-strong',
}

interface VerdictInlineProps extends VerdictInput {
  visible: boolean
}

/**
 * The live mini-verdict beside the phone field on New Order. It stays mounted
 * and reserves no space until a full number is typed, so the row does not jump.
 */
export function VerdictInline({ visible, ...input }: VerdictInlineProps) {
  const verdict = computeVerdict(input)
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[12px] font-semibold transition-opacity',
        TONE[verdict.tone],
        visible ? 'opacity-100' : 'opacity-0',
      )}
      aria-hidden={!visible}
    >
      {verdict.numeral !== '—' ? verdict.numeral : verdict.short}
    </span>
  )
}
