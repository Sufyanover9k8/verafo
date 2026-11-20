import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { readCallCredits, type CallCredits } from '@/lib/calls'
import { useStoreScope } from '@/lib/store'

/** A call can spend credits while the merchant is sitting on any page, so the
 *  figure refreshes on the same one-minute beat the mobile app polls. */
const POLL_MS = 60_000

/**
 * Talk time left, in the rail just above the account. One credit is one second
 * of call time, so the bar and the number agree with Settings → Calling and
 * with what `call-queue` will actually allow.
 */
export function CallCredits() {
  const { store, scopeStoreIds, loading } = useStoreScope()
  const [credits, setCredits] = useState<CallCredits | null>(null)

  useEffect(() => {
    if (loading) return
    let alive = true
    const load = () => {
      readCallCredits(scopeStoreIds, store?.id ?? null)
        .then((next) => {
          if (alive) setCredits(next)
        })
        .catch(() => {
          /* A refused call-queue must never break the rail. */
        })
    }
    load()
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [loading, scopeStoreIds, store?.id])

  const left = credits ? credits.credits.toLocaleString() : '—'
  const talk = credits ? `${credits.minutes.toLocaleString()} min of talk left` : 'Talk time left'
  const spent = credits
    ? `${left} credits left — ${talk}. Spent PKR ${Math.round(credits.spentPkr).toLocaleString()} of ${Math.round(credits.budgetPkr).toLocaleString()} this month.`
    : talk

  return (
    <NavLink
      to="/settings"
      title={spent}
      aria-label={spent}
      className="mx-2 mb-1 block rounded-xl px-2 py-2 transition-colors hover:bg-sidebar-accent/60 group-data-[collapsible=icon]:hidden"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">
          Call credits
        </span>
        <Zap className="size-3 shrink-0 text-sidebar-foreground/35" />
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[15px] font-semibold leading-none tabular-nums text-sidebar-foreground">
          {left}
        </span>
        <span className="text-[11px] text-sidebar-foreground/50">
          {credits ? `left · ${credits.minutes.toLocaleString()} min` : 'left'}
        </span>
      </div>
      <div className="mt-1.5 h-[3px] overflow-hidden rounded-full bg-sidebar-foreground/15">
        <div
          className="h-full rounded-full bg-sidebar-primary transition-[width] duration-500"
          style={{ width: `${Math.round((credits?.remaining ?? 0) * 100)}%` }}
        />
      </div>
    </NavLink>
  )
}
