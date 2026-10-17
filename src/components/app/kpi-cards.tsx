import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Trend = 'up' | 'down' | 'flat'

/**
 * One headline figure with its period-over-period change.
 *
 * A delta is only rendered when the caller could actually compare two windows
 * of the same length — `delta` stays null otherwise, so a thin sample shows no
 * percentage rather than a misleading one. `upIsGood` decides the colour, so a
 * rising refusal count reads as bad news.
 */
export interface KpiCardProps {
  label: string
  value: string
  icon: LucideIcon
  /** Percentage change against the previous window, or null when not comparable. */
  delta?: number | null
  /** What the delta compares against, e.g. "vs previous 7 days". */
  deltaLabel?: string
  upIsGood?: boolean
  /** Quiet line under the figure when there is no delta to show. */
  hint?: string
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  delta = null,
  deltaLabel,
  upIsGood = true,
  hint,
}: KpiCardProps) {
  const shown = delta != null && Number.isFinite(delta) ? Math.round(delta) : null
  const trend: Trend = shown == null || shown === 0 ? 'flat' : shown > 0 ? 'up' : 'down'
  const good = trend === 'flat' ? null : (trend === 'up') === upIsGood
  const DeltaIcon = trend === 'up' ? ArrowUpRight : trend === 'down' ? ArrowDownRight : Minus

  return (
    /*
     * Phone-first sizing. At full width on a 390px screen this card was ~145px
     * tall, so four of them filled the entire first screen and pushed the
     * verdict — the actual answer — below the fold. Two per row with tighter
     * padding and a smaller numeral keeps the opening view useful.
     */
    <div className="flex min-w-0 flex-col gap-2 rounded-[var(--r-card)] border border-border bg-card p-3.5 sm:gap-3 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-[11.5px] font-medium text-muted-foreground sm:text-[12.5px]">{label}</span>
        <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-accent text-accent-foreground sm:size-9 sm:rounded-[10px]">
          <Icon className="size-4 sm:size-[18px]" aria-hidden="true" />
        </span>
      </div>

      <p className="font-mono text-[20px] leading-none font-semibold tracking-tight tabular-nums text-foreground sm:text-[26px]">
        {value}
      </p>

      {shown != null ? (
        <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] sm:text-[12px]">
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-semibold tabular-nums',
              good === true && 'text-risk-safe-strong',
              good === false && 'text-risk-high-strong',
              good === null && 'text-muted-foreground',
            )}
          >
            <DeltaIcon className="size-3.5" aria-hidden="true" />
            {shown > 0 ? '+' : ''}
            {shown}%
          </span>
          {deltaLabel && <span className="text-muted-foreground max-sm:hidden">{deltaLabel}</span>}
        </p>
      ) : (
        hint && <p className="text-[11.5px] text-muted-foreground sm:text-[12px]">{hint}</p>
      )}
    </div>
  )
}

/**
 * The four risk bands, as one fill each. Kept next to the donut so the segment
 * and its legend dot can never drift apart.
 */
const BAND: Record<'safe' | 'watch' | 'high' | 'unknown', { arc: string; dot: string }> = {
  safe: { arc: 'text-risk-safe', dot: 'bg-risk-safe' },
  watch: { arc: 'text-risk-watch', dot: 'bg-risk-watch' },
  high: { arc: 'text-risk-high', dot: 'bg-risk-high' },
  unknown: { arc: 'text-risk-unknown', dot: 'bg-risk-unknown' },
}

export interface DonutSlice {
  label: string
  value: number
  band: keyof typeof BAND
}

/**
 * Risk distribution as a donut, with the book total in the middle and a legend
 * carrying every count and share. The ring is decorative; the legend beside it
 * is the accessible reading, so the numbers are never only in the graphic.
 */
export function RiskDonut({ slices, total }: { slices: DonutSlice[]; total: number }) {
  const sum = slices.reduce((n, s) => n + s.value, 0)
  const R = 54
  const STROKE = 18
  const C = 2 * Math.PI * R
  let offset = 0

  return (
    <div className="flex flex-wrap items-center justify-center gap-6">
      <div className="relative shrink-0" style={{ width: 148, height: 148 }}>
        <svg width={148} height={148} viewBox="0 0 148 148" className="-rotate-90" aria-hidden="true">
          <circle cx={74} cy={74} r={R} fill="none" strokeWidth={STROKE} className="stroke-muted" />
          {sum > 0 &&
            slices.map((s) => {
              const len = (s.value / sum) * C
              const el = (
                <circle
                  key={s.label}
                  cx={74}
                  cy={74}
                  r={R}
                  fill="none"
                  strokeWidth={STROKE}
                  stroke="currentColor"
                  className={BAND[s.band].arc}
                  strokeDasharray={`${len} ${C - len}`}
                  strokeDashoffset={-offset}
                />
              )
              offset += len
              return el
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[24px] leading-none font-semibold tabular-nums text-foreground">
            {total.toLocaleString('en-PK')}
          </span>
          <span className="mt-1 text-[11px] text-muted-foreground">buyers</span>
        </div>
      </div>

      <ul className="m-0 flex min-w-[11rem] list-none flex-col gap-2.5 p-0">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-4 text-[13px]">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className={cn('size-2.5 shrink-0 rounded-full', BAND[s.band].dot)} aria-hidden="true" />
              {s.label}
            </span>
            <span className="tabular-nums">
              <span className="font-semibold text-foreground">{s.value.toLocaleString('en-PK')}</span>
              <span className="ms-2 text-[12px] text-muted-foreground">
                {sum > 0 ? Math.round((s.value / sum) * 100) : 0}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
