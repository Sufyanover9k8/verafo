import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, CheckCheck, ClipboardList, Loader2, MapPin } from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { VerdictBlock } from '../components/verdict/VerdictBlock'
import { VerdictInline } from '../components/verdict/VerdictInline'
import { EmptyState, NeedsSetup } from '../components/States'
import { Reveal } from '../components/Reveal'
import { normalizePhone, phone } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { Buyer, Store } from '../lib/types'

/** What buyer_network_lookup returns. Aggregates only - no identity. */
interface NetworkLookupRow {
  risk_score: number | null
  total_orders: number | null
  total_accepted: number | null
  total_refused: number | null
  store_count: number | null
  first_seen: string | null
}

const CATEGORIES = ['skincare', 'clothing', 'electronics', 'footwear', 'beauty', 'home', 'accessories', 'other']

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unknown' }
  | { kind: 'buyer'; buyer: Buyer; storeCount: number }

/** One styled control, shared by every input and select on this form. */
const CONTROL =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)] md:h-10 md:text-[15px]'

/** A labelled field. The label is tied to the control by id. */
function Field({
  id,
  label,
  className,
  children,
}: {
  id: string
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <label htmlFor={id} className="text-[13px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

export function NewOrder() {
  const toast = useToast()
  const { role, store, stores: myStores } = useStoreScope()
  const [stores, setStores] = useState<Store[]>([])
  const [phoneInput, setPhoneInput] = useState('')
  const [storeId, setStoreId] = useState('')
  const [category, setCategory] = useState('skincare')
  const [productName, setProductName] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState<PreviewState>({ kind: 'idle' })
  const [lastOrder, setLastOrder] = useState<{ buyer: Buyer; storeCount: number } | null>(null)
  const previewTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!supabase) return
    // Merchants can only log orders against their own store(s).
    if (role !== 'admin') {
      const list = myStores.map((s) => ({ id: s.id, name: s.name, owner_email: null })) as Store[]
      setStores(list)
      setStoreId((cur) => cur || store?.id || list[0]?.id || '')
      return
    }
    supabase
      .from('stores')
      .select('id, name, owner_email')
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          toast.push({ kind: 'error', title: 'Could not load stores', detail: error.message })
          return
        }
        setStores(data ?? [])
        const preferred = store?.id ?? data?.[0]?.id ?? ''
        if (preferred) setStoreId((cur) => cur || preferred)
      })
  }, [toast, role, myStores, store])

  const normalizedPhone = useMemo(() => normalizePhone(phoneInput), [phoneInput])

  const fetchPreview = useCallback(async (p: string) => {
    if (!supabase) return
    setPreview({ kind: 'loading' })
    // PRIVACY: this used to run `from('buyers').select('*')`, which pulled the
    // raw embedding and feature vector into the browser. buyer_network_lookup
    // returns the same risk answer as aggregate counts, with no vector and no
    // identity, so the live verdict still works the same way.
    const [lookupRes, ordersRes] = await Promise.all([
      supabase.rpc('buyer_network_lookup', { p_phone: p }),
      supabase.from('orders').select('store_id').eq('buyer_phone', p),
    ])
    if (lookupRes.error) {
      setPreview({ kind: 'unknown' })
      return
    }
    const row = ((lookupRes.data ?? []) as NetworkLookupRow[])[0]
    if (!row) {
      setPreview({ kind: 'unknown' })
      return
    }
    const buyer: Buyer = {
      phone: p,
      first_seen: row.first_seen ?? null,
      total_orders: row.total_orders ?? 0,
      total_accepted: row.total_accepted ?? 0,
      total_refused: row.total_refused ?? 0,
      risk_score: Number(row.risk_score ?? 0.5),
      store_count: row.store_count ?? 0,
      embedding: null,
    }
    const storeCount = row.store_count ?? new Set((ordersRes.data ?? []).map((o) => o.store_id)).size
    setPreview({ kind: 'buyer', buyer, storeCount })
  }, [])

  useEffect(() => {
    if (previewTimer.current) window.clearTimeout(previewTimer.current)
    if (normalizedPhone.length < 6) {
      setPreview({ kind: 'idle' })
      return
    }
    previewTimer.current = window.setTimeout(() => {
      void fetchPreview(normalizedPhone)
    }, 450)
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current)
    }
  }, [normalizedPhone, fetchPreview])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (normalizedPhone.length < 6) {
      toast.push({ kind: 'error', title: 'Phone number required', detail: 'Enter a full phone number to log the order.' })
      return
    }
    if (!storeId) {
      toast.push({ kind: 'error', title: 'No store selected', detail: 'Add at least one store row (see supabase/seed.sql).' })
      return
    }
    const priceNum = parseFloat(price)
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      toast.push({ kind: 'error', title: 'Invalid price' })
      return
    }
    const qty = Math.max(1, parseInt(quantity, 10) || 1)

    setSubmitting(true)
    try {
      // ignoreDuplicates → ON CONFLICT DO NOTHING: we only need the stub row to
      // exist so orders.buyer_phone has something to point at. The real
      // totals/score are written by the recompute trigger, which (unlike a
      // plain UPDATE from here) isn't subject to RLS — see rls-production.sql.
      const { error: buyerErr } = await supabase
        .from('buyers')
        .upsert({ phone: normalizedPhone }, { onConflict: 'phone', ignoreDuplicates: true })
      if (buyerErr) throw buyerErr

      const { error: orderErr } = await supabase.from('orders').insert({
        buyer_phone: normalizedPhone,
        store_id: storeId,
        product_category: category,
        product_name: productName.trim() || null,
        price: priceNum,
        quantity: qty,
        address: address.trim() || null,
        city: city.trim() || null,
      })
      if (orderErr) throw orderErr

      // PRIVACY: this used to be select('*') right after the score pipeline
      // ran, which pulled the freshly written embedding and feature vector back
      // into the browser. Only the fields the UI shows are requested now.
      const { data: buyer, error: fetchErr } = await supabase
        .from('buyers')
        .select('phone, risk_score, total_orders, total_accepted, total_refused, first_seen')
        .eq('phone', normalizedPhone)
        .single()
      if (fetchErr) throw fetchErr

      const ordersRes = await supabase.from('orders').select('store_id').eq('buyer_phone', normalizedPhone)
      const storeCount = new Set((ordersRes.data ?? []).map((o) => o.store_id)).size

      const scoredBuyer: Buyer = { ...(buyer as unknown as Buyer), embedding: null }

      setLastOrder({ buyer: scoredBuyer, storeCount })
      setPreview({ kind: 'buyer', buyer: scoredBuyer, storeCount })
      toast.push({
        kind: 'success',
        title: 'Order logged',
        detail: `${productName.trim() || category} · ${phone(normalizedPhone)} — score updated.`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({ kind: 'error', title: 'Failed to log order', detail: message })
    } finally {
      setSubmitting(false)
    }
  }

  if (!isConfigured) return <NeedsSetup />

  const liveInput: { risk_score: number; total_orders: number } | null =
    preview.kind === 'buyer' ? { risk_score: preview.buyer.risk_score, total_orders: preview.buyer.total_orders } : null

  return (
    <PageShell>
      <PageHeader
        title="New Order"
        description="Log an order and see the buyer's risk profile instantly — across every connected store."
      />

      <Reveal stagger className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card className="gap-5 p-6">
          <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
            {/* The phone field and its live verdict share one row. */}
            <div className="flex flex-wrap items-end gap-3">
              <Field id="order-phone" label="Phone number" className="min-w-[14rem] flex-1">
                <input
                  id="order-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  className={`${CONTROL} font-mono`}
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="0301 234 5678"
                  autoFocus
                  required
                />
              </Field>
              <VerdictInline
                visible={normalizedPhone.length >= 7}
                risk_score={liveInput?.risk_score ?? 0.5}
                total_orders={liveInput?.total_orders ?? 0}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="order-store" label="Store">
                <select
                  id="order-store"
                  className={CONTROL}
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  required
                >
                  {stores.length === 0 && <option value="">No stores yet</option>}
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="order-category" label="Category">
                <select
                  id="order-category"
                  className={CONTROL}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="order-product" label="Product" className="sm:col-span-2">
                <input
                  id="order-product"
                  type="text"
                  className={CONTROL}
                  value={productName}
                  onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Vitamin C serum 30ml"
                />
              </Field>

              <Field id="order-price" label="Price (PKR)">
                <input
                  id="order-price"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className={`${CONTROL} font-mono`}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="2499"
                  required
                />
              </Field>

              <Field id="order-quantity" label="Quantity">
                <input
                  id="order-quantity"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  className={`${CONTROL} font-mono`}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </Field>

              <Field id="order-address" label="Address" className="sm:col-span-2">
                <input
                  id="order-address"
                  type="text"
                  className={CONTROL}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="House, street, area"
                />
              </Field>

              <Field id="order-city" label="City" className="sm:col-span-2">
                <input
                  id="order-city"
                  type="text"
                  className={CONTROL}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Lahore"
                />
              </Field>
            </div>

            <div className="border-t border-border pt-5">
              <Button type="submit" className="h-11 w-full gap-2 px-5 sm:w-auto" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Logging order…
                  </>
                ) : (
                  <>
                    <CheckCheck className="size-4" /> Log order
                  </>
                )}
              </Button>
            </div>
          </form>
        </Card>

        <Card className="gap-4 self-start p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-foreground">Buyer insight</h2>
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-risk-safe" aria-hidden="true" /> live
            </span>
          </div>

          {preview.kind === 'idle' && (
            <EmptyState
              icon="fingerprint"
              title="Type a phone number"
              detail="The risk verdict appears here as you type — before the order is even saved."
            />
          )}

          {preview.kind === 'loading' && (
            <p className="flex items-center gap-2 py-8 text-[13.5px] text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" /> Checking the network…
            </p>
          )}

          {preview.kind === 'unknown' && (
            <div className="flex flex-col gap-4">
              <VerdictBlock risk_score={0.5} total_orders={0} />
              <p className="text-[13.5px] text-muted-foreground">
                Unknown buyer — no history in the network yet. Starting at neutral <strong className="font-semibold text-foreground">0.50</strong>.
              </p>
            </div>
          )}

          {preview.kind === 'buyer' && (
            <div className="flex flex-col gap-4">
              <VerdictBlock
                risk_score={preview.buyer.risk_score}
                total_orders={preview.buyer.total_orders}
                total_accepted={preview.buyer.total_accepted}
                total_refused={preview.buyer.total_refused}
                stores={preview.storeCount}
                firstSeen={preview.buyer.first_seen}
              />
              <dl className="grid grid-cols-4 gap-2">
                {[
                  { label: 'orders', value: preview.buyer.total_orders },
                  { label: 'accepted', value: preview.buyer.total_accepted },
                  { label: 'refused', value: preview.buyer.total_refused },
                  { label: 'stores', value: preview.storeCount },
                ].map((s) => (
                  <div key={s.label} className="rounded-[10px] border border-border bg-muted/40 px-2 py-2.5 text-center">
                    <dd className="font-mono text-[17px] font-semibold tabular-nums text-foreground">{s.value}</dd>
                    <dt className="mt-0.5 text-[11.5px] text-muted-foreground">{s.label}</dt>
                  </div>
                ))}
              </dl>
              <Link
                to={`/lookup?phone=${encodeURIComponent(preview.buyer.phone)}`}
                className="inline-flex h-11 items-center gap-1.5 text-[13px] font-semibold text-primary-text hover:underline md:h-9"
              >
                <ArrowRight className="size-3.5" /> Full profile
              </Link>
            </div>
          )}
        </Card>
      </Reveal>

      {lastOrder && (
        <Reveal>
          <div className="flex flex-wrap items-center gap-4 rounded-[16px] border border-risk-safe/40 bg-risk-safe-soft p-5">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-card text-risk-safe-strong">
              <BadgeCheck className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold text-foreground">
                Order logged for {phone(lastOrder.buyer.phone)}
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Score updated to{' '}
                <strong className="font-semibold tabular-nums text-foreground">
                  {lastOrder.buyer.risk_score.toFixed(2)}
                </strong>{' '}
                across {lastOrder.storeCount} store{lastOrder.storeCount === 1 ? '' : 's'}.
              </p>
            </div>
            <Button asChild variant="outline" className="h-11 gap-2 px-4 md:h-9">
              <Link to="/orders/pending">
                <ClipboardList className="size-4" /> Mark outcome
              </Link>
            </Button>
          </div>
        </Reveal>
      )}

      {/* Two destinations this screen leads to, stated once at the bottom. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5" aria-hidden="true" /> City and address feed the RTO insights.
        </span>
        <Link to="/import" className="font-medium text-primary-text hover:underline">
          Import history instead
        </Link>
      </div>
    </PageShell>
  )
}
