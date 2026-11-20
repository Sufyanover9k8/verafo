import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { readCreditsForStores, type CreditStatus } from '@/lib/credits'
import { useStoreScope } from '@/lib/store'

/** Credits move while the merchant is working, so the figure refreshes on the
 *  same one-minute beat the mobile app polls. */
const POLL_MS = 60_000

/**
 * Credits left, in the rail just above the account. One check is one credit
 * and one call minute is one credit, so this is the same number the dashboard
 * refuses work against.
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

  const total = credits ? credits.included + credits.overageAllowed : 0
  const left = credits ? Math.round(credits.remaining).toLocaleString() : '—'
  const plan = credits ? credits.planName : 'Credits'
  const detail = credits
    ? `${left} credits left on ${plan}. ${Math.round(credits.used).toLocaleString()} of ${total.toLocaleString()} used this month${
        credits.overage > 0
          ? `, ${Math.round(credits.overage).toLocaleString()} of them over the plan at PKR ${credits.overageRate} each`
          : ''
      }${credits.cycleEnd ? `. Resets ${new Date(credits.cycleEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}.`
    : 'Credits left this month'

  const usedFraction = credits && total > 0 ? Math.min(1, credits.used / total) : 0
  const spent = credits ? Math.round(credits.used).toLocaleString() : '—'

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
          {left}
        </span>
        <span className="text-[11px] text-sidebar-foreground/50">
          {credits ? `left · ${plan}` : 'left'}
        </span>
      </div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-sidebar-foreground/15">
        <div
          className="h-full rounded-full bg-sidebar-primary transition-[width] duration-500"
          style={{ width: `${Math.round(usedFraction * 100)}%` }}
        />
      </div>
      <div className="mt-0.5 text-[10px] text-sidebar-foreground/40">{spent} used</div>
    </NavLink>
  )
}
