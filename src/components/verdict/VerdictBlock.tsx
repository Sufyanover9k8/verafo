import { computeVerdict, type VerdictInput } from '../../lib/risk'

interface VerdictBlockProps extends VerdictInput {
  stores?: number
  firstSeen?: string | null
}

/** The signature element — a large serif score with a confidence readout. */
export function VerdictBlock({ stores, firstSeen, ...input }: VerdictBlockProps) {
  const verdict = computeVerdict(input)
  const orders = Math.max(0, Number(input.total_orders ?? 0) || 0)
  const accepted = Math.max(0, Number(input.total_accepted ?? 0) || 0)
  const refused = Math.max(0, Number(input.total_refused ?? 0) || 0)

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
    <div className="verdict-block" data-tone={verdict.tone}>
      <div className="verdict-top">
        <span className="verdict-eyebrow">Risk verdict</span>
        <span className="verdict-conf">{verdict.confidenceLabel}</span>
      </div>
      <div className="verdict-main">
        <span className="verdict-numeral">{verdict.numeral}</span>
        <span className="verdict-title">{verdict.title}</span>
      </div>
      {meta.length > 0 && <hr className="verdict-divider" />}
      {meta.length > 0 && <p className="verdict-meta">{meta.join(' · ')}</p>}
    </div>
  )
}
