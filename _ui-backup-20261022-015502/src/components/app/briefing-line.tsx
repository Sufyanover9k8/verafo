import { sentence } from '@/lib/ui'

/**
 * The one-line briefing at the top of the dashboard.
 *
 * Built only from data the dashboard has already loaded. Any part the data
 * cannot supply is simply left out — the line never guesses.
 */
export interface BriefingInput {
  /** Pending orders from buyers who already look risky. */
  waiting: number
  /** The riskiest waiting order's city, when the order has one. */
  riskiestCity?: string | null
  /** The riskiest waiting order's value, when the order has a price. */
  riskiestAmount?: number | null
  /** How many buyers have been scored at all. */
  scoredBuyers: number
  /** The period the numbers below cover, for example "7 days". */
  rangeLabel?: string
}

export function briefingLine(input: BriefingInput): string {
  const { waiting, riskiestCity, riskiestAmount, scoredBuyers } = input

  if (waiting === 0) {
    return scoredBuyers > 0
      ? 'Nothing is waiting on you before you ship.'
      : 'No orders have been scored yet. Scores appear as orders come in.'
  }

  const head = `${waiting} order${waiting === 1 ? '' : 's'} need${waiting === 1 ? 's' : ''} a look`

  const amount =
    riskiestAmount == null || Number.isNaN(Number(riskiestAmount))
      ? null
      : `PKR ${Math.round(Number(riskiestAmount)).toLocaleString('en-PK')}`

  const tail = sentence([riskiestCity, amount])
  return tail
    ? `${head}. The riskiest is ${tail}.`
    : `${head}. Open the list below to see them.`
}
