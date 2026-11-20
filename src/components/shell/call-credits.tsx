import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Phone, Zap } from 'lucide-react'
import { overageCallPkr, overagePkr, readCreditsForStores, type CreditStatus } from '@/lib/credits'
import { useStoreScope } from '@/lib/store'

/** Allowances move while the merchant is working, so the figure refreshes on
 *  the same one-minute beat the mobile app polls. */
const POLL_MS = 60_000

/**
 * Allowances in the rail, just above the account. Checks and calls are two
 * pools: packaged checks left (or the extra ones being bought) on the first
 * line, the call allowance on the second.
 */
export function CallCredits() {
  const { store, scopeStoreIds, loading } = useStoreScope()
  const [credits, setCredits] = useState<CreditStatus | null>(null)

  useEffect(() => {
    if (loading) return
    const ids = scopeStoreIds && scopeStoreIds.length ? scopeStoreIds : store?.id ? [store.id] : []
    if (!ids.length) return
    let alive = true
    const load = () => {
      readCreditsForStores(ids)
        .then((next) => {
          if (alive) setCredits(next)
        })
        .catch(() => {
          /* A refused read must never break the rail. */
        })
    }
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [loading, scopeStoreIds, store?.id])

  const over = credits ? credits.overage > 0 : false
  const unlimited = Boolean(credits?.unlimited)
  const owed = overagePkr(credits)
  const left = credits ? Math.round(credits.remaining).toLocaleString() : '—'
  const plan = credits ? credits.planName : 'Credits'
  const value = unlimited
    ? 'Unlimited'
    : over
      ? `${Math.round(credits!.overage).toLocaleString()} over`
      : left
  const sub = unlimited
    ? `checks · ${plan}`
    : over
      ? `PKR ${owed.toLocaleString()} so far`
      : `left · ${plan}`

  const callsLeft = credits ? Math.round(credits.remainingCalls).toLocaleString() : '—'
  const callsTotal = credits ? Math.round(credits.includedCalls).toLocaleString() : '—'
  const callsOver = credits ? credits.overageCalls > 0 : false
  const callsLine = callsOver
    ? `${Math.round(credits!.overageCalls).toLocaleString()} extra · PKR ${overageCallPkr(credits).toLocaleString()}`
    : `${callsLeft} of ${callsTotal} calls`

  const detail = credits
    ? [
        unlimited
          ? `Unlimited check credits on ${plan} (${Math.round(credits.used).toLocaleString()} used this month).`
          : `${left} check credits left on ${plan} (${Math.round(credits.used).toLocaleString()} of ${Math.round(credits.included).toLocaleString()} used this month${
              credits.overageRate > 0 ? `, PKR ${credits.overageRate} a check beyond that` : ''
            }).`,
        credits.callsOneTime
          ? `${callsLeft} of ${callsTotal} free calls left; they never reset.`
          : `${callsLeft} of ${callsTotal} calls left this month${
              credits.overageRatePerCall > 0 ? `, then PKR ${credits.overageRatePerCall} a call` : ''
            }.`,
        credits.overage > 0 || credits.overageCalls > 0
          ? `PKR ${(owed + overageCallPkr(credits)).toLocaleString()} is added to the next Shopify invoice.`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    : 'Allowances left this month'

  const usedFraction = credits && credits.included > 0 ? Math.min(1, credits.used / credits.included) : 0
  const callsFraction =
    credits && credits.includedCalls > 0
      ? Math.min(1, credits.usedCalls / credits.includedCalls)
      : 0

  return (
    <NavLink
      to="/settings"
      title={detail}
      aria-label={detail}
      className="mx-2 mb-1 block rounded-xl px-2 py-2 transition-colors hover:bg-sidebar-accent/60 group-data-[collapsible=icon]:hidden"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">
          Credits
        </span>
        <Zap className="size-3 shrink-0 text-sidebar-foreground/35" />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[15px] font-semibold leading-none tabular-nums text-sidebar-foreground">
          {value}
        </span>
        <span className="text-[11px] text-sidebar-foreground/50">{sub}</span>
      </div>
      <div
        className={`mt-1.5 h-[3px] overflow-hidden rounded-full bg-sidebar-foreground/15 ${unlimited ? 'invisible' : ''}`}
      >
        <div
          className="h-full rounded-full bg-sidebar-primary transition-[width] duration-500"
          style={{ width: `${Math.round(usedFraction * 100)}%` }}
        />
      </div>

      {/* Calls have their own allowance, so they get their own line. */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-sidebar-foreground/55">
        <span className="inline-flex items-center gap-1">
          <Phone className="size-3 shrink-0 text-sidebar-foreground/35" />
          {callsLine}
        </span>
        {credits?.callsOneTime ? (
          <span className="text-[10px] uppercase tracking-[0.1em] text-sidebar-foreground/35">one time</span>
        ) : null}
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-sidebar-foreground/15">
        <div
          className="h-full rounded-full bg-sidebar-foreground/45 transition-[width] duration-500"
          style={{ width: `${Math.round(callsFraction * 100)}%` }}
        />
      </div>
    </NavLink>
  )
}
