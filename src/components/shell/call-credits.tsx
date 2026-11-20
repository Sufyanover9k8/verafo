import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { overagePkr, readCreditsForStores, type CreditStatus } from '@/lib/credits'
import { useStoreScope } from '@/lib/store'

/** Credits move while the merchant is working, so the figure refreshes on the
 *  same one-minute beat the mobile app polls. */
const POLL_MS = 60_000

/**
 * Credits in the rail, just above the account: packaged credits left while the
 * plan has some, then the extra credits it is buying.
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
  const owed = overagePkr(credits)
  const left = credits ? Math.round(credits.remaining).toLocaleString() : '—'
  const plan = credits ? credits.planName : 'Credits'
  const value = over ? `${Math.round(credits!.overage).toLocaleString()} over` : left
  const sub = over ? `PKR ${owed.toLocaleString()} so far` : `left · ${plan}`

  const detail = credits
    ? over
      ? `${Math.round(credits.overage).toLocaleString()} credits past the ${plan} package at PKR ${credits.overageRate} each — PKR ${owed.toLocaleString()} added to the next Shopify invoice.`
      : `${left} credits left on ${plan}. ${Math.round(credits.used).toLocaleString()} of ${Math.round(credits.included).toLocaleString()} used this month at PKR ${credits.overageRate} a credit beyond the package.`
    : 'Credits left this month'

  const usedFraction = credits && credits.included > 0 ? Math.min(1, credits.used / credits.included) : 0

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
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-sidebar-foreground/15">
        <div
          className="h-full rounded-full bg-sidebar-primary transition-[width] duration-500"
          style={{ width: `${Math.round(usedFraction * 100)}%` }}
        />
      </div>
    </NavLink>
  )
}
