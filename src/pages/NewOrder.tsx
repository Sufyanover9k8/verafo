import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { VerdictBlock } from '../components/verdict/VerdictBlock'
import { VerdictInline } from '../components/verdict/VerdictInline'
import { EmptyState, NeedsSetup } from '../components/States'
import { Reveal } from '../components/Reveal'
import { normalizePhone, phone } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { Buyer, Store } from '../lib/types'

const CATEGORIES = ['skincare', 'clothing', 'electronics', 'footwear', 'beauty', 'home', 'accessories', 'other']

type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'unknown' }
  | { kind: 'buyer'; buyer: Buyer; storeCount: number }

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
    const [buyerRes, ordersRes] = await Promise.all([
      supabase.from('buyers').select('*').eq('phone', p).maybeSingle(),
      supabase.from('orders').select('store_id').eq('buyer_phone', p),
    ])
    if (buyerRes.error || !buyerRes.data) {
      setPreview({ kind: 'unknown' })
      return
    }
    const storeCount = new Set((ordersRes.data ?? []).map((o) => o.store_id)).size
    setPreview({ kind: 'buyer', buyer: buyerRes.data, storeCount })
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

      const { data: buyer, error: fetchErr } = await supabase
        .from('buyers')
        .select('*')
        .eq('phone', normalizedPhone)
        .single()
      if (fetchErr) throw fetchErr

      const ordersRes = await supabase.from('orders').select('store_id').eq('buyer_phone', normalizedPhone)
      const storeCount = new Set((ordersRes.data ?? []).map((o) => o.store_id)).size

      setLastOrder({ buyer, storeCount })
      setPreview({ kind: 'buyer', buyer, storeCount })
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
    <div className="stack">
      <PageHeader
        icon="bag-handle"
        title="New Order"
        subtitle="Log an order and see the buyer's risk profile instantly — across every connected store."
      />

      <Reveal stagger className="order-layout">
        <form className="card form-card" onSubmit={handleSubmit}>
          <div className="phone-field-row">
            <label className="field">
              <span className="field-label">
                <Icon name="phone-portrait" size={15} /> Phone number
              </span>
              <input
                type="tel"
                inputMode="tel"
                className="mono"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="0301 234 5678"
                autoFocus
                required
              />
            </label>
            <VerdictInline
              visible={normalizedPhone.length >= 7}
              risk_score={liveInput?.risk_score ?? 0.5}
              total_orders={liveInput?.total_orders ?? 0}
            />
          </div>

          <div className="form-grid">
            <label className="field">
              <span className="field-label">
                <Icon name="storefront" size={15} /> Store
              </span>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)} required>
                {stores.length === 0 && <option value="">No stores yet</option>}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">
                <Icon name="pricetags" size={15} /> Category
              </span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label className="field span-2">
              <span className="field-label">
                <Icon name="cube" size={15} /> Product
              </span>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g. Vitamin C serum 30ml"
              />
            </label>

            <label className="field">
              <span className="field-label">
                <Icon name="card" size={15} /> Price (PKR)
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="2499"
                required
              />
            </label>

            <label className="field">
              <span className="field-label">
                <Icon name="layers" size={15} /> Quantity
              </span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </label>

            <label className="field span-2">
              <span className="field-label">
                <Icon name="location" size={15} /> Address
              </span>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="House, street, area"
              />
            </label>

            <label className="field span-2">
              <span className="field-label">
                <Icon name="business" size={15} /> City
              </span>
              <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Lahore" />
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary btn-lg" disabled={submitting}>
              {submitting ? (
                <>
                  <Icon name="refresh" size={17} className="spin" /> Logging order…
                </>
              ) : (
                <>
                  <Icon name="checkmark-done" size={17} /> Log order
                </>
              )}
            </button>
          </div>
        </form>

        <aside className="card verdict-panel">
          <div className="verdict-panel-head">
            <span className="verdict-panel-title">Buyer insight</span>
            <span className="verdict-live-tag">
              <span className="conn-dot" /> live
            </span>
          </div>

          {preview.kind === 'idle' && (
            <EmptyState
              icon="phone-portrait"
              title="Type a phone number"
              detail="The risk verdict appears here as you type — before the order is even saved."
            />
          )}

          {preview.kind === 'loading' && (
            <div className="preview-loading">
              <Icon name="refresh" size={20} className="spin" /> Checking the network…
            </div>
          )}

          {preview.kind === 'unknown' && (
            <div className="stack">
              <VerdictBlock risk_score={0.5} total_orders={0} />
              <p className="card-sub">
                Unknown buyer — no history in the network yet. Starting at neutral{' '}
                <strong>0.50</strong>.
              </p>
            </div>
          )}

          {preview.kind === 'buyer' && (
            <div className="stack">
              <VerdictBlock
                risk_score={preview.buyer.risk_score}
                total_orders={preview.buyer.total_orders}
                total_accepted={preview.buyer.total_accepted}
                total_refused={preview.buyer.total_refused}
                stores={preview.storeCount}
                firstSeen={preview.buyer.first_seen}
              />
              <div className="preview-stats">
                <div>
                  <strong>{preview.buyer.total_orders}</strong>
                  <span>orders</span>
                </div>
                <div>
                  <strong>{preview.buyer.total_accepted}</strong>
                  <span>accepted</span>
                </div>
                <div>
                  <strong>{preview.buyer.total_refused}</strong>
                  <span>refused</span>
                </div>
                <div>
                  <strong>{preview.storeCount}</strong>
                  <span>stores</span>
                </div>
              </div>
              <Link className="link" to={`/lookup?phone=${encodeURIComponent(preview.buyer.phone)}`}>
                <Icon name="arrow-forward" size={14} /> Full profile
              </Link>
            </div>
          )}
        </aside>
      </Reveal>

      {lastOrder && (
        <Reveal>
        <div className="card result-card">
          <div className="result-row">
            <span className="result-icon">
              <Icon name="checkmark-circle" size={20} />
            </span>
            <div className="grow">
              <strong>Order logged for {phone(lastOrder.buyer.phone)}</strong>
              <p className="result-line">
                Score updated to <strong>{lastOrder.buyer.risk_score.toFixed(2)}</strong> across{' '}
                {lastOrder.storeCount} store{lastOrder.storeCount === 1 ? '' : 's'}.
              </p>
            </div>
            <Link className="btn btn-secondary" to="/orders/pending">
              <Icon name="clipboard" size={15} /> Mark outcome
            </Link>
          </div>
        </div>
        </Reveal>
      )}
    </div>
  )
}