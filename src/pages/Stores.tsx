import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock, Loader2, Mail, Phone, Plus, Search, ShieldAlert, Trash2 } from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '../components/primitives/Skeleton'
import { EmptyState, NeedsSetup } from '../components/States'
import { CountUpNumber } from '../components/CountUpNumber'
import { Avatar } from '../components/Avatar'
import { Reveal } from '../components/Reveal'
import { useIsAdmin } from '../lib/admin'
import { phone, dateOnly } from '../lib/format'
import { computeStoreOverview, type StoreLite } from '../lib/storeStats'
import { isConfigured, supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { OrderRow, StoreOverview } from '../lib/types'

export function Stores() {
  const toast = useToast()
  const { admin, checking } = useIsAdmin()
  const [stores, setStores] = useState<StoreOverview[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<StoreOverview | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    const fullRes = await supabase
      .from('stores')
      .select('id, name, owner_email, created_at, shopify_domain, category, contact_phone')
      .order('name')
    const storesRes = fullRes.error
      ? await supabase
          .from('stores')
          .select('id, name, owner_email, created_at, shopify_domain')
          .order('name')
      : fullRes
    const overviewRes = await supabase.rpc('store_overview')
    const storesData = (storesRes.data ?? []) as StoreLite[]
    if (overviewRes.error) {
      if (!storesRes.error) {
        const ordersRes = await supabase
          .from('orders')
          .select('store_id, price, quantity, ordered_at, outcomes(status)')
          .limit(2000)
        setStores(computeStoreOverview((ordersRes.data ?? []) as unknown as OrderRow[], storesData))
      } else {
        toast.push({ kind: 'error', title: 'Could not load stores', detail: storesRes.error.message })
      }
    } else {
      setStores((overviewRes.data ?? []) as StoreOverview[])
    }
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDelete(store: StoreOverview) {
    if (!supabase) return
    setDeletingId(store.id)
    const detach = await supabase.from('orders').update({ store_id: null }).eq('store_id', store.id)
    if (!detach.error) {
      await supabase.from('stores').delete().eq('id', store.id)
    }
    setDeletingId(null)
    setPendingDelete(null)
    if (detach.error) {
      toast.push({ kind: 'error', title: 'Could not delete store', detail: detach.error.message })
      return
    }
    toast.push({ kind: 'success', title: 'Store deleted', detail: store.name })
    setStores((prev) => prev.filter((s) => s.id !== store.id))
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return stores
    return stores.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.shopify_domain ?? '').toLowerCase().includes(q) ||
        (s.category ?? '').toLowerCase().includes(q),
    )
  }, [stores, query])

  if (!isConfigured) return <NeedsSetup />

  return (
    <PageShell>
      <PageHeader
        title="Stores"
        description="Manage connected ecommerce brands."
        actions={
          <Button asChild className="h-11 gap-2 rounded-full px-5">
            <Link to="/stores/add">
              <Plus className="size-4" /> Add store
            </Link>
          </Button>
        }
      />

      {checking ? (
        <Card className="gap-3 p-6" aria-busy="true">
          <Skeleton height={16} width="40%" />
          <Skeleton height={16} width="65%" />
        </Card>
      ) : !admin ? (
        <Card className="gap-0 p-6">
          <EmptyState
            icon="shield-checkmark"
            title="Restricted to admins"
            detail="Only administrators can view and manage stores. Head back to the dashboard to continue."
            action={
              <Button asChild className="h-11 gap-2 rounded-full px-5">
                <Link to="/">
                  <ArrowRight className="size-4" /> Back to dashboard
                </Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold text-foreground">All stores</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {stores.length} {stores.length === 1 ? 'brand' : 'brands'} in the network
              </p>
            </div>
            <div className="relative w-full sm:w-80">
              <Search
                className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, domain or category"
                aria-label="Search stores"
                className="h-11 ps-8 md:h-10"
              />
            </div>
          </div>

          <Card className="gap-0 overflow-hidden p-0">
            {loading ? (
              <div className="flex flex-col divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-5">
                    <Skeleton width={38} height={38} className="rounded-full" />
                    <div className="flex-1">
                      <Skeleton width="60%" height={14} />
                      <div className="mt-2">
                        <Skeleton width="40%" height={12} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                icon="storefront"
                title={stores.length === 0 ? 'No stores yet' : 'No matches'}
                detail={
                  stores.length === 0
                    ? 'Add your first e-brand to start tracking its orders.'
                    : 'Try a different store name, domain or category.'
                }
              />
            ) : (
              <Reveal stagger className="flex flex-col divide-y divide-border">
                {filtered.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-4 p-5">
                    <Avatar name={s.name} size={38} />
                    <div className="min-w-[12rem] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14.5px] font-semibold text-foreground">{s.name}</span>
                        {s.category && (
                          <span className="rounded-full border border-risk-unknown/40 bg-risk-unknown-soft px-2 py-0.5 text-[11.5px] font-medium text-risk-unknown-strong">
                            {s.category}
                          </span>
                        )}
                        {s.shopify_domain && (
                          <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground">
                            {s.shopify_domain}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                        {s.owner_email && (
                          <span className="inline-flex items-center gap-1.5">
                            <Mail className="size-3.5" aria-hidden="true" /> {s.owner_email}
                          </span>
                        )}
                        {s.contact_phone && (
                          <span className="inline-flex items-center gap-1.5 font-mono">
                            <Phone className="size-3.5" aria-hidden="true" /> {phone(s.contact_phone)}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="size-3.5" aria-hidden="true" /> added {dateOnly(s.created_at)}
                        </span>
                      </div>
                    </div>

                    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted-foreground">
                      <div>
                        <dd className="font-mono text-[14px] font-semibold tabular-nums text-foreground">
                          <CountUpNumber value={s.orders} />
                        </dd>
                        <dt>orders</dt>
                      </div>
                      <div>
                        <dd className="font-mono text-[14px] font-semibold tabular-nums text-foreground">
                          <CountUpNumber prefix="PKR " value={s.revenue} />
                        </dd>
                        <dt>sales</dt>
                      </div>
                      <div>
                        <dd className="font-mono text-[14px] font-semibold tabular-nums text-foreground">
                          <CountUpNumber value={s.buyers} />
                        </dd>
                        <dt>buyers</dt>
                      </div>
                    </dl>

                    <div className="flex items-center gap-2">
                      <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 px-3 md:h-9">
                        <Link to={`/stores/${s.id}`}>
                          <ArrowRight className="size-3.5" /> View
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground hover:bg-risk-high-soft hover:text-risk-high-strong md:size-9"
                        title={`Delete ${s.name}`}
                        aria-label={`Delete ${s.name}`}
                        disabled={deletingId === s.id}
                        onClick={() => setPendingDelete(s)}
                      >
                        {deletingId === s.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </Reveal>
            )}
          </Card>
        </>
      )}

      {/* Deleting a store detaches its orders, so it is spelled out and confirmed. */}
      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{pendingDelete?.name}”?</DialogTitle>
            <DialogDescription>
              The store is removed from the network. Orders that belong to it are kept but detached, so they will no
              longer appear under any store. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2.5 rounded-[10px] border border-risk-high/40 bg-risk-high-soft p-3 text-[12.5px] text-risk-high-strong">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {pendingDelete?.orders ?? 0} order{pendingDelete?.orders === 1 ? '' : 's'} will be detached from this
              store.
            </span>
          </div>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              disabled={deletingId !== null}
              onClick={() => pendingDelete && void handleDelete(pendingDelete)}
            >
              {deletingId ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete store
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
