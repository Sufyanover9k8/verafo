import { Link } from 'react-router-dom'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPKR } from '@/lib/ui'
import { readPref, writePref } from '@/lib/ui/prefs'
import { useState } from 'react'

export const CHECKLIST_HIDDEN_KEY = 'dashboard.checklistHidden'

/**
 * A small "get started" card for a store that has not finished setting up.
 * Each item is detected from data the dashboard already loaded — nothing is
 * assumed and nothing is scored. The card disappears on its own once every
 * item is done, and the merchant can hide it for good on this device.
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
  const [hidden, setHidden] = useState(() => readPref(CHECKLIST_HIDDEN_KEY) === '1')

  const items = [
    { label: 'Store connected', done: hasStore, to: '/settings', cta: 'Open settings' },
    { label: 'First order scored', done: hasScoredOrder, to: '/import', cta: 'Import history' },
    { label: 'First outcome marked', done: hasOutcome, to: '/orders/pending', cta: 'Mark outcomes' },
  ]

  const allDone = items.every((i) => i.done)
  // Nothing to nudge: either finished, or the merchant hid it.
  if (allDone || hidden) return null

  const doneCount = items.filter((i) => i.done).length

  return (
    <div className="rounded-[16px] border border-border bg-card p-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Finish setting up</h2>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            {doneCount} of {items.length} done. Verafo gets sharper with each step.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border px-3 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted md:h-8"
          onClick={() => {
            writePref(CHECKLIST_HIDDEN_KEY, '1')
            setHidden(true)
          }}
        >
          <X className="size-3.5" /> Hide
        </button>
      </div>

      <ul className="flex flex-col divide-y divide-border">
        {items.map((i) => (
          <li key={i.label} className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-3">
            <span className="flex items-center gap-2.5 text-[14px]">
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full border',
                  i.done ? 'border-risk-safe bg-risk-safe-soft text-risk-safe-strong' : 'border-border text-transparent',
                )}
                aria-hidden="true"
              >
                <Check className="size-3" />
              </span>
              <span className={i.done ? 'text-muted-foreground line-through' : 'text-foreground'}>{i.label}</span>
            </span>
            {!i.done && (
              <Link
                to={i.to}
                className="inline-flex h-11 items-center rounded-[10px] border border-border px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted md:h-8"
              >
                {i.cta}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
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
      <div className="flex flex-col gap-5 rounded-[16px] border border-border bg-card p-6">
        <h2 className="text-[15px] font-semibold text-foreground">Money at stake</h2>
        {cod}
        {lost}
        {footnote}
      </div>
    )
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {cod && <div className="rounded-[16px] border border-border bg-card p-6">{cod}</div>}
      {lost && <div className="rounded-[16px] border border-border bg-card p-6">{lost}</div>}
      <div className="sm:col-span-2">{footnote}</div>
    </div>
  )
}
