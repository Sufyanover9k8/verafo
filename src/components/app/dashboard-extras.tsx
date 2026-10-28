import { Link } from 'react-router-dom'
import { Check, ChevronDown, Sparkles, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPKR } from '@/lib/ui'
import { readPref, writePref } from '@/lib/ui/prefs'
import { parseCollapsedAt, SETUP_CHECKLIST_KEY, setupCardMode } from '@/lib/ui/setup-checklist'
import { useState } from 'react'

/** Kept for callers/tests that referenced the old name. */
export const CHECKLIST_HIDDEN_KEY = SETUP_CHECKLIST_KEY

/**
 * A small "get started" card for a store that has not finished setting up.
 * Each item is detected from data the dashboard already loaded — nothing is
 * assumed and nothing is scored.
 *
 * Hide minimises it to one row instead of removing it: setup is the only thing
 * a brand-new merchant has to do, so the reminder stays (with the next step as a
 * button) until the work is actually done. The full card also comes back by
 * itself after a week — see lib/ui/setup-checklist.ts.
 */
interface FirstRunChecklistProps {
  /** A store row exists for this merchant. */
  hasStore: boolean
  /** At least one order has been scored. */
  hasScoredOrder: boolean
  /** At least one outcome has been marked. */
  hasOutcome: boolean
}

export function FirstRunChecklist({ hasStore, hasScoredOrder, hasOutcome }: FirstRunChecklistProps) {
  const [collapsedAt, setCollapsedAt] = useState<number | null>(() =>
    parseCollapsedAt(readPref(SETUP_CHECKLIST_KEY)),
  )

  const items = [
    { label: 'Store connected', done: hasStore, to: '/settings', cta: 'Open settings' },
    { label: 'First order scored', done: hasScoredOrder, to: '/import', cta: 'Import history' },
    { label: 'First outcome marked', done: hasOutcome, to: '/orders/pending', cta: 'Mark outcomes' },
  ]

  const allDone = items.every((i) => i.done)
  // Expiry is decided inside the helper (it owns the clock), so the component
  // stays pure.
  const mode = setupCardMode({ allDone, collapsedAt })
  const doneCount = items.filter((i) => i.done).length
  /** The first thing still missing: the only step offered as a filled button. */
  const nextStep = items.find((i) => !i.done)
  const percent = Math.round((doneCount / items.length) * 100)

  if (mode === 'hidden') return null

  /*
   * Minimised: one row that cannot be dismissed away. It carries the progress,
   * the next step as a real button, and the way back to the full card — so
   * "Hide" buys quiet without losing the thread.
   */
  if (mode === 'compact') {
    return (
      <section
        aria-label="Finish setting up"
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[var(--r-card)] border border-primary/30 bg-primary/[0.06] px-4 py-3"
      >
        <span
          className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground"
          aria-hidden="true"
        >
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1 basis-full sm:basis-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-[13.5px] font-semibold text-foreground">
            Finish setting up
            <span className="font-normal text-muted-foreground">
              {doneCount} of {items.length} done
              {nextStep ? ` · next: ${nextStep.label.toLowerCase()}` : ''}
            </span>
          </p>
          <div
            className="mt-2 h-1 w-full max-w-[320px] overflow-hidden rounded-full bg-primary/15"
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-label={`${doneCount} of ${items.length} setup steps done`}
          >
            <span className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {nextStep && (
            <Link
              to={nextStep.to}
              className="inline-flex h-11 items-center rounded-[10px] bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 md:h-9"
            >
              {nextStep.cta}
            </Link>
          )}
          <button
            type="button"
            aria-expanded={false}
            className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted md:h-9"
            onClick={() => {
              writePref(SETUP_CHECKLIST_KEY, null)
              setCollapsedAt(null)
            }}
          >
            <ChevronDown className="size-3.5" aria-hidden="true" /> Show steps
          </button>
        </div>
      </section>
    )
  }

  return (
    /* Brand-coloured and at the top of the page: while setup is unfinished there
       is nothing to read a verdict from, so this is the block that should win
       the merchant's attention. It removes itself once every step is done. */
    <section
      aria-label="Finish setting up"
      className="rounded-[var(--r-card)] border border-primary/40 bg-primary/[0.06] p-5"
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground">
            <Sparkles className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold text-foreground">Finish setting up</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {doneCount} of {items.length} done — Verafo gets sharper with each step.
            </p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Minimise setup steps"
          title="Minimise — the reminder stays until setup is finished"
          className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border bg-card px-3 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted md:h-8"
          onClick={() => {
            const at = Date.now()
            writePref(SETUP_CHECKLIST_KEY, String(at))
            setCollapsedAt(at)
          }}
        >
          <X className="size-3.5" aria-hidden="true" /> Hide
        </button>
      </div>

      {/* How far along, in one line. */}
      <div
        className="mb-2 h-1.5 w-full overflow-hidden rounded-full bg-primary/15"
        role="progressbar"
        aria-valuenow={doneCount}
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-label={`${doneCount} of ${items.length} setup steps done`}
      >
        <span
          className="block h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ul className="flex flex-col divide-y divide-primary/15">
        {items.map((i) => (
          <li key={i.label} className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-3">
            <span className="flex items-center gap-2.5 text-[14px]">
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full border',
                  i.done
                    ? 'border-risk-safe bg-risk-safe-soft text-risk-safe-strong'
                    : 'border-primary/40 bg-card text-transparent',
                )}
                aria-hidden="true"
              >
                <Check className="size-3" />
              </span>
              <span className={i.done ? 'text-muted-foreground line-through' : 'font-medium text-foreground'}>
                {i.label}
              </span>
            </span>
            {!i.done && (
              <Link
                to={i.to}
                className={cn(
                  'inline-flex h-11 items-center rounded-[10px] px-3.5 text-[12.5px] font-semibold transition-colors md:h-8',
                  i.label === nextStep?.label
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border bg-card text-foreground hover:bg-muted',
                )}
              >
                {i.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Two money figures: what is riding on COD right now, and what refusals cost in
 * the chosen period. Both are shown only when the underlying data exists.
 *
 * `layout="stack"` renders one card, so the block can sit in a grid column
 * beside the risk distribution; the default renders two cards side by side and
 * returns a fragment at the top level.
 */
interface MoneyRiskProps {
  /** PKR of pending orders from MEDIUM or HIGH risk buyers. */
  codAtRisk: number | null
  /** PKR of refused orders in the period. */
  lostToRefusals: number | null
  rangeLabel: string
  /** How many orders the figures were computed from. */
  basedOn: number
  layout?: 'row' | 'stack'
}

export function MoneyRiskCards({
  codAtRisk,
  lostToRefusals,
  rangeLabel,
  basedOn,
  layout = 'row',
}: MoneyRiskProps) {
  if (codAtRisk == null && lostToRefusals == null) return null

  const figure = (label: string, value: number, help: string) => (
    <div>
      <p className="text-[11.5px] font-medium tracking-[0.14em] text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 font-mono text-[26px] leading-none font-semibold tabular-nums text-foreground">
        {formatPKR(value)}
      </p>
      <p className="mt-2 text-[13px] text-muted-foreground">{help}</p>
    </div>
  )

  const cod =
    codAtRisk != null &&
    figure('Cash on delivery waiting', codAtRisk, 'Pending orders from buyers who look MEDIUM or HIGH risk.')
  const lost =
    lostToRefusals != null &&
    figure('Lost to refusals', lostToRefusals, `Refused orders in the last ${rangeLabel}.`)
  const footnote = (
    <p className="text-[11.5px] text-muted-foreground">
      Based on your latest {basedOn.toLocaleString('en-PK')} orders.
    </p>
  )

  if (layout === 'stack') {
    return (
      <div className="flex flex-col gap-5 rounded-[var(--r-card)] border border-border bg-card p-5">
        <h2 className="text-[15px] font-semibold text-foreground">Money at stake</h2>
        {cod}
        {lost}
        {footnote}
      </div>
    )
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {cod && <div className="rounded-[var(--r-card)] border border-border bg-card p-5">{cod}</div>}
      {lost && <div className="rounded-[var(--r-card)] border border-border bg-card p-5">{lost}</div>}
      <div className="sm:col-span-2">{footnote}</div>
    </div>
  )
}
