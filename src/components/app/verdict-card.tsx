import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { VerdictTone } from '@/lib/risk'
import { RiskRing } from './risk-ring'

/* The four tones, as tokens. Both a fill (for bars and dots) and a text
   shade (readable in light and dark) — never a hex. */
const TONE: Record<
  VerdictTone,
  { word: string; bar: string; text: string; soft: string; ring: string; dot: string }
> = {
  safe: {
    word: 'LOW RISK',
    bar: 'bg-risk-safe',
    text: 'text-risk-safe-strong',
    soft: 'bg-risk-safe-soft',
    ring: 'text-risk-safe',
    dot: 'bg-risk-safe',
  },
  watch: {
    word: 'MEDIUM RISK',
    bar: 'bg-risk-watch',
    text: 'text-risk-watch-strong',
    soft: 'bg-risk-watch-soft',
    ring: 'text-risk-watch',
    dot: 'bg-risk-watch',
  },
  high: {
    word: 'HIGH RISK',
    bar: 'bg-risk-high',
    text: 'text-risk-high-strong',
    soft: 'bg-risk-high-soft',
    ring: 'text-risk-high',
    dot: 'bg-risk-high',
  },
  unknown: {
    word: 'UNKNOWN',
    bar: 'bg-risk-unknown',
    text: 'text-risk-unknown-strong',
    soft: 'bg-risk-unknown-soft',
    ring: 'text-risk-unknown',
    dot: 'bg-risk-unknown',
  },
}

export interface VerdictSignal {
  /** The reason, in plain words — as the app already returns it. */
  label: string
  /** Which way it moves the score. */
  impact: 'pos' | 'neg' | 'none'
}

interface VerdictCardProps {
  tone: VerdictTone
  /** 0–1, or null when there is not enough data to score. */
  score?: number | null
  /** One plain sentence under the word. */
  sentence: string
  /**
   * What the ring's number actually measures. Required whenever the score is
   * shown, so a reader is never left guessing whether the figure is this order,
   * a buyer, or the whole book.
   */
  ringCaption?: string
  /** The reasons the app already returns. Bars are drawn from these. */
  signals?: VerdictSignal[]
  /** Small honest line about where the numbers came from. */
  footnote?: string
  /** Anything the caller wants under the signals (actions, notes). */
  children?: ReactNode
  className?: string
}

/**
 * The signature verdict card, rebuilt from the Verafo website's risk card:
 * a soft plate tinted by risk level, the verdict word, a filling score ring,
 * and the signals that moved the score.
 *
 * Every value comes from data the app already has. When the score is null
 * (not enough resolved orders) the ring is replaced by a plain line, and the
 * card never claims SAFE.
 */
export function VerdictCard({
  tone,
  score,
  sentence,
  ringCaption = 'risk score',
  signals,
  footnote,
  children,
  className,
}: VerdictCardProps) {
  const t = TONE[tone]
  const scored = tone !== 'unknown' && score != null && Number.isFinite(Number(score))

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--r-xl)] border border-border bg-card p-6',
        className,
      )}
    >
      {/* Soft wash in the risk colour, so the card reads at a glance. */}
      <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 opacity-60', t.soft)} />
      <span
        aria-hidden="true"
        className={cn('pointer-events-none absolute inset-x-0 top-0 h-0.5', t.bar)}
      />

      <div className="relative flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="text-[11.5px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              Verdict
            </span>
            <div className="mt-1.5 flex items-center gap-2.5">
              <span className={cn('size-3 rounded-full', t.dot)} aria-hidden="true" />
              <h2 className={cn('text-[30px] leading-none font-bold tracking-tight', t.text)}>
                {t.word}
              </h2>
            </div>
            <p className="mt-3 max-w-md text-[15px] text-foreground">{sentence}</p>
          </div>

          {scored ? (
            /* Sized down from the numeral scale so the ring and its tick labels
               sit clear of the card edge, and dropped on the narrowest screens
               where the headline and sentence need the full width. The same
               figure is in the sentence for screen readers either way. */
            <div className="shrink-0 max-sm:hidden">
              <RiskRing score={Number(score)} size={112} toneClass={t.ring} caption={ringCaption} />
            </div>
          ) : (
            <div className="flex h-[112px] w-[112px] shrink-0 items-center justify-center rounded-full border border-dashed border-border px-4 text-center max-sm:hidden">
              <span className="text-[13px] text-muted-foreground">No score yet</span>
            </div>
          )}
        </div>

        {signals && signals.length > 0 && (
          <div className="border-t border-border pt-4">
            <h3 className="mb-3 text-[13px] font-semibold text-foreground">Signals that moved the score</h3>
            <ul className="flex flex-col gap-2.5">
              {signals.map((s, i) => (
                <li key={`${s.label}-${i}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn('size-2 rotate-45', s.impact === 'neg' ? 'bg-risk-high' : s.impact === 'pos' ? 'bg-risk-safe' : 'bg-risk-unknown')}
                  />
                  <span className="min-w-0 text-[13.5px] text-foreground">{s.label}</span>
                  <span
                    className={cn(
                      'font-mono text-[11.5px] whitespace-nowrap',
                      s.impact === 'neg'
                        ? 'text-risk-high-strong'
                        : s.impact === 'pos'
                          ? 'text-risk-safe-strong'
                          : 'text-muted-foreground',
                    )}
                  >
                    {s.impact === 'neg' ? 'raises risk' : s.impact === 'pos' ? 'lowers risk' : 'neutral'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {children && <div className="border-t border-border pt-4">{children}</div>}

        {footnote && <p className="text-[11.5px] text-muted-foreground">{footnote}</p>}
      </div>
    </div>
  )
}
