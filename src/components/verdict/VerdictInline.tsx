import { computeVerdict, type VerdictInput } from '../../lib/risk'

interface VerdictInlineProps extends VerdictInput {
  visible: boolean
}

/** Live mini-verdict that appears beside the phone field as it's typed. */
export function VerdictInline({ visible, ...input }: VerdictInlineProps) {
  const verdict = computeVerdict(input)
  return (
    <span className={`verdict-inline${visible ? ' visible' : ''}`} data-tone={verdict.tone} aria-hidden={!visible}>
      {verdict.numeral !== '—' ? verdict.numeral : verdict.short}
    </span>
  )
}
