import { computeVerdict, type VerdictInput } from '../../lib/risk'

interface VerdictChipProps extends VerdictInput {
  showScore?: boolean
}

/** Compact pill for tables and lists: `● 0.12 LOW`. */
export function VerdictChip({ showScore = true, ...input }: VerdictChipProps) {
  const verdict = computeVerdict(input)
  return (
    <span className="verdict-chip" data-tone={verdict.tone}>
      <span className="verdict-chip-dot" aria-hidden="true" />
      {showScore && verdict.numeral !== '—' && `${verdict.numeral} `}
      {verdict.short}
    </span>
  )
}
