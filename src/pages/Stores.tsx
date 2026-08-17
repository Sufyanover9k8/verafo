import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Card } from '../components/primitives/Card'
import { Skeleton } from '../components/primitives/Skeleton'
import { EmptyState, NeedsSetup } from '../components/States'
import { CountUpNumber } from '../components/CountUpNumber'
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
    if (!window.confirm(`Delete "${store.name}" from the network? Linked orders will be kept but detached.`)) {
      return
    }
    setDeletingId(store.id)
    const detach = await supabase.from('orders').update({ store_id: null }).eq('store_id', store.id)
    if (!detach.error) {
      await supabase.from('stores').delete().eq('id', store.id)
    }
    setDeletingId(null)
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
    <div className="stack">
      <PageHeader
        icon="storefront"
        title="Stores"
        subtitle="Manage connected ecommerce brands."
        actions={
          <Link className="btn btn-primary" to="/stores/add">
            <Icon name="add" size={15} /> Add store
          </Link>
        }
      />

      {checking ? (
        <Card>
          <Skeleton height={16} />
          <Skeleton height={16} />
        </Card>
      ) : !admin ? (
        <Card>
          <EmptyState
            icon="shield-checkmark"
            title="Restricted to admins"
            detail="Only administrators can view and manage stores. Head back to the dashboard to continue."
          />
          <div className="store-restricted-cta">
            <Link className="btn btn-primary" to="/">
              <Icon name="arrow-forward" size={14} /> Back to dashboard
            </Link>
          </div>
        </Card>
      ) : (
        <section className="chart-section">
          <div className="verdict-panel-head">
            <h3 className="card-title">All stores</h3>
            <span className="verdict-conf">
              {stores.length} {stores.length === 1 ? 'brand' : 'brands'} · search by name
            </span>
          </div>
          <div className="store-search">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stores by name, domain or category…"
              aria-label="Search stores"
            />
          </div>
          <Card className="card--flush">
            {loading ? (
              <div className="store-list">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div className="store-row" key={i}>
                    <span className="store-row-avatar-skeleton">
                      <Skeleton width={38} height={38} />
                    </span>
                    <div className="store-row-main">
                      <Skeleton width="60%" height={14} />
                      <Skeleton width="40%" height={12} />
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
              <div className="store-list">
                {filtered.map((s, i) => (
                  <div
                    className="store-row"
                    key={s.id}
                    style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
                  >
                    <span className="store-row-avatar">
                      {s.name ? s.name.charAt(0).toUpperCase() : '?'}
                    </span>
                    <div className="store-row-main">
                      <div className="store-row-name">
                        {s.name}
                        {s.category && <span className="chip chip-cyan">{s.category}</span>}
                        {s.shopify_domain && <span className="chip">{s.shopify_domain}</span>}
                      </div>
                      <div className="store-row-meta">
                        {s.owner_email && (
                          <span>
                            <Icon name="person" size={13} /> {s.owner_email}
                          </span>
                        )}
                        {s.contact_phone && (
                          <span>
                            <Icon name="phone-portrait" size={13} /> {phone(s.contact_phone)}
                          </span>
                        )}
                        <span>
                          <Icon name="time" size={13} /> added {dateOnly(s.created_at)}
                        </span>
                      </div>
                    </div>
                    <div className="store-row-stats">
                      <span>
                        <CountUpNumber value={s.orders} /> orders
                      </span>
                      <span>
                        <CountUpNumber prefix="PKR " value={s.revenue} /> sales
                      </span>
                      <span>
                        <CountUpNumber value={s.buyers} /> buyers
                      </span>
                    </div>
                    <div className="store-row-actions">
                      <Link className="btn btn-secondary btn-sm" to={`/stores/${s.id}`}>
                        <Icon name="arrow-forward" size={13} /> View
                      </Link>
                      <button
                        className="icon-btn danger"
                        title="Delete store"
                        disabled={deletingId === s.id}
                        onClick={() => void handleDelete(s)}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>
      )}
    </div>
  )
}