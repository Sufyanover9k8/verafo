/* ============================================================
   components/app/risk-filter.tsx — narrow a list to one risk band.

   A merchant scanning Outcomes or Orders is usually looking for one thing:
   "which of these are the risky ones". Sorting answers that badly — it moves
   rows without removing them — so this drops everything outside the band and
   lets the tab counts follow, which is what makes the number above a tab
   trustworthy.

   The bands are the app's four words, and they come from the same function the
   badge uses (`buyerBand`), so a row can never be filtered into a band it is
   not displaying.
   ============================================================ */

import { ShieldAlert, ShieldCheck, ShieldQuestion, CircleHelp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buyerBand } from './verdict-badge'

export type RiskFilterValue = 'all' | 'high' | 'medium' | 'safe' | 'neutral'

interface RiskFilterProps {
  id?: string
  value: RiskFilterValue
  onChange: (value: RiskFilterValue) => void
  /** Hide the visible label; the select keeps an aria-label either way. */
  labelled?: boolean
  className?: string
}

const OPTIONS: { value: RiskFilterValue; label: string }[] = [
  { value: 'all', label: 'Any risk' },
  { value: 'high', label: 'High risk' },
  { value: 'medium', label: 'Medium risk' },
  { value: 'safe', label: 'Safe' },
  { value: 'neutral', label: 'No data yet' },
]

/**
 * The filter's own words, for the "what is narrowing this list" summary line.
 * Keyed by value so the sentence and the control can never disagree.
 */
export const RISK_FILTER_SUMMARY: Record<RiskFilterValue, string> = {
  all: 'any risk',
  high: 'high risk',
  medium: 'medium risk',
  safe: 'safe',
  neutral: 'no data yet',
}

/**
 * Does a buyer fall in the chosen band?
 *
 * `totalOrders` matters: a buyer with fewer than three resolved orders is
 * NEUTRAL regardless of score, exactly as the badge shows them. Filtering on
 * the raw score alone would surface "high risk" rows whose badge reads NEUTRAL,
 * which looks like a bug to whoever is reading the list.
 */
export function orderMatchesRisk(
  riskScore: number | null | undefined,
  totalOrders: number | null | undefined,
  filter: RiskFilterValue,
): boolean {
  if (filter === 'all') return true
  return buyerBand(riskScore, totalOrders) === filter
}

export function RiskFilter({ id = 'risk-filter', value, onChange, labelled = true, className }: RiskFilterProps) {
  const Icon =
    value === 'high'
      ? ShieldAlert
      : value === 'medium'
        ? CircleHelp
        : value === 'safe'
          ? ShieldCheck
          : ShieldQuestion

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {labelled && (
        <label htmlFor={id} className="text-[13px] font-medium text-muted-foreground">
          Risk
        </label>
      )}
      <div className="relative">
        <Icon
          className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <select
          id={id}
          aria-label="Filter by risk band"
          value={value}
          onChange={(e) => onChange(e.target.value as RiskFilterValue)}
          className="h-11 w-full appearance-none rounded-[10px] border border-input bg-card ps-8 pe-8 text-[16px] text-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)] md:h-10 md:text-[15px]"
        >
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span
          className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        >
          ▾
        </span>
      </div>
    </div>
  )
}
