/* ============================================================
   components/app/shopify-claim-card.tsx — connect the store Shopify made.

   The gap this closes, seen in production: the Shopify app creates a `stores`
   row from the shop domain with `owner_email` NULL. Every dashboard query is
   scoped to `owner_email = <you>`, so those orders are invisible to the merchant
   who owns the shop — the database gains rows, the screen gains none.

   Claiming used to live only in onboarding, which never runs for a merchant who
   already has a store. This is the same action, visible to them:
     · a banner on the dashboard, while an ownerless store has orders
     · a panel in Settings, always, so it stays findable
   ============================================================ */

import { useCallback, useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { ArrowRight, Link2, Loader2, Store, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useStoreScope } from '../../lib/store'
import { useToast } from '../../lib/toast'
import { claimShopifyStore, listClaimableStores, type ClaimableStore } from '../../lib/stores'

interface Props {
  /**
   * banner — one line, dashboard only, rendered solely when a store is waiting.
   * panel  — the full list plus the manual domain route, for Settings.
   */
  variant: 'banner' | 'panel'
}

export function ShopifyClaimCard({ variant }: Props) {
  const toast = useToast()
  const { reload } = useStoreScope()
  const [stores, setStores] = useState<ClaimableStore[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setStores(await listClaimableStores())
    setLoaded(true)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function claim(target: string) {
    if (busy) return
    setBusy(target)
    setManualError(null)
    const res = await claimShopifyStore(target)
    setBusy(null)

    if (!res.ok) {
      if (res.reason === 'not_found') {
        // Not a failure: nothing is waiting under that domain.
        setManualError('No unconnected Shopify store matches that domain yet.')
        return
      }
      setManualError(res.message)
      toast.push({ kind: 'error', title: 'Could not connect', detail: res.message })
      return
    }

    toast.push({
      kind: 'success',
      title: res.alreadyOwned ? 'Already connected' : 'Shopify store connected',
      detail: res.storeName ? `${res.storeName} — its orders are now in your dashboard.` : undefined,
    })
    setDomain('')
    // Re-resolve the store scope so the newly owned orders appear at once,
    // without reloading the app.
    reload()
    void load()
  }

  if (variant === 'banner') {
    // Silent unless there is something the merchant can actually fix.
    if (!loaded || stores.length === 0) return null
    const first = stores[0]
    /*
     * One candidate → connect it in place; it can only be the shop this
     * merchant just installed. Several → send them to Settings to choose.
     * A banner that always claimed `stores[0]` is how one account ended up
     * owning other people's rows: each click took the next one silently.
     */
    const single = stores.length === 1
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-[var(--r-card)] border border-risk-watch/40 bg-risk-watch-soft px-4 py-3">
        <Unplug className="size-4 shrink-0 text-risk-watch-strong" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-risk-watch-strong">
          <strong className="font-semibold">{first.domain} is sending orders Verafo cannot show you.</strong>{' '}
          {first.orders > 0
            ? `${first.orders} order${first.orders === 1 ? '' : 's'} waiting to be connected.`
            : 'Connect it to see them here.'}
        </p>
        {single ? (
          <Button
            className="h-11 shrink-0 gap-2 px-4 md:h-9"
            disabled={busy !== null}
            onClick={() => void claim(first.domain)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}
            Connect store
          </Button>
        ) : (
          <Button asChild className="h-11 shrink-0 gap-2 px-4 md:h-9">
            <RouterLink to="/settings">
              {stores.length} stores to review
              <ArrowRight className="size-4" />
            </RouterLink>
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Orders from a Shopify store only appear here once that store is connected to your account.
        An unconnected store keeps receiving orders, silently, in its own row.
      </p>

      {stores.length > 0 ? (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {stores.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 text-primary">
                <Store className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] font-medium text-foreground">{s.domain}</p>
                <p className="text-[12px] text-muted-foreground">
                  {s.orders > 0 ? `${s.orders} order${s.orders === 1 ? '' : 's'} waiting` : 'No orders yet'}
                </p>
              </div>
              <Button
                className="h-11 shrink-0 gap-2 px-4 md:h-9"
                disabled={busy !== null}
                onClick={() => void claim(s.domain)}
              >
                {busy === s.domain ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                Connect
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {loaded
            ? 'Nothing to connect here. Connecting happens inside Shopify: open the Verafo app in your Shopify admin and press Connect, and your store is linked automatically.'
            : 'Checking…'}
        </p>
      )}

      {/* The manual route, for a store whose first order has not arrived yet. */}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <Label htmlFor="claim-domain">Or enter the domain directly</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="claim-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="your-store.myshopify.com"
            autoComplete="off"
            className="h-11 min-w-[14rem] flex-1"
          />
          <Button
            variant="outline"
            className="h-11 px-4 md:h-9"
            disabled={busy !== null || domain.trim() === ''}
            onClick={() => void claim(domain)}
          >
            Connect
          </Button>
        </div>
        {manualError && (
          <p role="alert" className="text-[12.5px] text-risk-high-strong">
            {manualError}
          </p>
        )}
      </div>
    </div>
  )
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted-foreground">
      {children}
    </label>
  )
}
