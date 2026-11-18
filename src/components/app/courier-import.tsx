import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { CheckCircle2, FileSpreadsheet, Loader2, Sparkles, UploadCloud, XCircle } from 'lucide-react'
import { parseCsv, sniffDelimiter, stripBom } from '@/lib/ui/import'
import { mapCourierColumnsWithAi, type CourierField } from '@/lib/ui/ai-column-map'
import {
  courierOutcome,
  courierUpdateAction,
  normalizeCourierPhone,
  normalizeCourierReference,
  normalizeStoredOutcome,
  parseCourierRows,
  type CourierRow,
  type StoredOutcome,
} from '@/lib/ui/courier-reconciliation'
import { canonicalPhone } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/lib/toast'
import type { Store } from '@/lib/types'

/** A courier row plus what it will do to the order it matched. */
interface PreviewRow {
  source: CourierRow
  orderId: string | null
  orderLabel: string
  action: 'change' | 'same' | 'hold' | 'create' | 'unmatched'
  next: 'accepted' | 'refused'
  stored: StoredOutcome
}

interface ExistingOrder {
  id: string
  buyer_phone: string | null
  order_reference: string | null
  shopify_order_id: string | null
  courier_tracking_number: string | null
  outcomes: { status: string | null } | { status: string | null }[] | null
}

const MATCH_LIMIT = 2000

function outcomeOf(order: ExistingOrder): StoredOutcome {
  const row = Array.isArray(order.outcomes) ? order.outcomes[0] : order.outcomes
  return normalizeStoredOutcome(row?.status)
}

export function CourierImport({ stores }: { stores: Store[] }) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [storeId, setStoreId] = useState(stores.length === 1 ? stores[0].id : '')
  const [headers, setHeaders] = useState<string[]>([])
  const [cells, setCells] = useState<string[][]>([])
  const [fileName, setFileName] = useState('')
  const [aiMapping, setAiMapping] = useState<Partial<Record<CourierField, string>>>({})
  const [aiBusy, setAiBusy] = useState(false)
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [imported, setImported] = useState<number | null>(null)
  /** Create orders for rows that match nothing, so their outcome still counts. */
  const [createMissing, setCreateMissing] = useState(true)

  const counts = useMemo(() => {
    const c = { change: 0, same: 0, hold: 0, create: 0, unmatched: 0 }
    for (const row of preview ?? []) c[row.action]++
    return c
  }, [preview])

  // The store list can arrive after mount, and with the picker hidden on a
  // single-store account there would be no way to fill an empty store id.
  useEffect(() => {
    if (!storeId && stores.length === 1) setStoreId(stores[0].id)
  }, [stores, storeId])

  async function readFile(file: File) {
    setImported(null)
    setPreview(null)
    setAiMapping({})
    setFileName(file.name)
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        const buffer = await file.arrayBuffer()
        const book = XLSX.read(buffer, { type: 'array', cellDates: true })
        const sheet = book.Sheets[book.SheetNames[0]]
        const table = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '' })
        const rows = table.map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')) : []))
        setHeaders((rows[0] ?? []).map((h) => h.trim()))
        setCells(rows.slice(1))
      } else {
        const text = stripBom(await file.text())
        setHeaders(parseCsv(text, sniffDelimiter(text))[0]?.map((h) => h.trim()) ?? [])
        setCells(parseCsv(text, sniffDelimiter(text)).slice(1))
      }
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not read that file',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function detectWithAi() {
    if (headers.length === 0) return
    setAiBusy(true)
    const result = await mapCourierColumnsWithAi(headers, cells.slice(0, 5))
    setAiBusy(false)
    if (!result) {
      toast.push({
        kind: 'error',
        title: 'AI mapping unavailable',
        detail: 'The verafo-ai function did not answer. Columns will be matched by name instead.',
      })
      return
    }
    setAiMapping(result.mapping)
    toast.push({
      kind: 'success',
      title: 'Columns detected',
      detail: `${Object.keys(result.mapping).length} of ${Object.keys(result.mapping).length + result.missing.length} fields mapped by AI.`,
    })
    // Detection only exists to feed the preview, so continue straight into it
    // instead of asking for a second click. The mapping is passed explicitly
    // because the state update above has not re-rendered yet.
    if (storeId) {
      await buildPreview(result.mapping)
    } else {
      toast.push({
        kind: 'info',
        title: 'Columns saved',
        detail: 'Pick a store above and the rows will be matched against it.',
      })
    }
  }

  async function buildPreview(mappingOverride?: Partial<Record<CourierField, string>>) {
    if (!supabase) return
    if (!storeId) {
      toast.push({ kind: 'error', title: 'Pick a store', detail: 'Courier rows are matched against one store.' })
      return
    }
    const parsed = parseCourierRows(headers, cells, mappingOverride ?? aiMapping)
    if (parsed.length === 0) {
      toast.push({ kind: 'error', title: 'Nothing to match', detail: 'No reference, tracking number or phone found in that file.' })
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('id, buyer_phone, order_reference, shopify_order_id, courier_tracking_number, outcomes(status)')
        .eq('store_id', storeId)
        .order('ordered_at', { ascending: false })
        .limit(MATCH_LIMIT)
      if (error) throw error
      const orders = (data ?? []) as ExistingOrder[]

      const byReference = new Map<string, ExistingOrder>()
      const byTracking = new Map<string, ExistingOrder>()
      const byPhone = new Map<string, ExistingOrder>()
      for (const order of orders) {
        for (const candidate of [order.order_reference, order.shopify_order_id]) {
          const key = normalizeCourierReference(candidate)
          if (key) byReference.set(key, order)
        }
        const tracking = normalizeCourierReference(order.courier_tracking_number)
        if (tracking) byTracking.set(tracking, order)
        const phone = normalizeCourierPhone(order.buyer_phone)
        if (phone) byPhone.set(phone, order)
      }

      const rows: PreviewRow[] = parsed.map((source) => {
        const order =
          (source.reference && byReference.get(normalizeCourierReference(source.reference))) ||
          (source.trackingNumber && byTracking.get(normalizeCourierReference(source.trackingNumber))) ||
          (source.phone && byPhone.get(normalizeCourierPhone(source.phone))) ||
          null

        const outcome = courierOutcome(source.status, source.reason)
        if (!order) {
          // An order the merchant shipped but never logged in Verafo still has
          // value: its outcome tells the network this buyer accepted or refused.
          // It can be created, provided we have a phone to anchor the buyer on.
          const canCreate = Boolean(source.phone) && outcome !== null && outcome !== 'pending'
          return {
            source,
            orderId: null,
            orderLabel: '-',
            action: canCreate ? 'create' : 'unmatched',
            next: outcome === 'refused' ? 'refused' : 'accepted',
            stored: null,
          }
        }
        const stored = outcomeOf(order)
        const action = courierUpdateAction(outcome, stored)
        return {
          source,
          orderId: order.id,
          orderLabel: order.order_reference || order.shopify_order_id || order.buyer_phone || order.id.slice(0, 8),
          action:
            action === 'update' ? 'change' : action === 'already' ? 'same' : 'hold',
          next: outcome === 'refused' ? 'refused' : 'accepted',
          stored,
        }
      })
      setPreview(rows)
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not match against your orders',
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!supabase || !preview) return
    const changes = preview.filter((row) => row.action === 'change' && row.orderId)
    // Orders the merchant shipped but never logged still carry a real outcome.
    // They are created so the buyer's history (and score) includes them.
    const creates = createMissing
      ? preview.filter((row) => row.action === 'create' && row.source.phone)
      : []

    if (changes.length === 0 && creates.length === 0) {
      toast.push({
        kind: 'info',
        title: 'Nothing to update',
        detail: 'Every matched order already has that outcome.',
      })
      return
    }

    setBusy(true)
    try {
      const resolvedAt = new Date().toISOString()

      if (changes.length > 0) {
        const { error } = await supabase.from('outcomes').upsert(
          changes.map((row) => ({
            order_id: row.orderId,
            status: row.next,
            resolved_at: row.source.resolvedAt ?? resolvedAt,
          })),
          { onConflict: 'order_id' },
        )
        if (error) throw error

        // Remember the courier's CN on the order, so the next report matches by
        // tracking number even when the reference column changes.
        const tracked = changes.filter((row) => row.source.trackingNumber && row.orderId)
        for (const row of tracked) {
          await supabase
            .from('orders')
            .update({ courier_tracking_number: row.source.trackingNumber })
            .eq('id', row.orderId)
            .is('courier_tracking_number', null)
        }
      }

      let created = 0
      if (creates.length > 0) {
        created = await createOrdersFromCourier(creates, resolvedAt)
      }

      setImported(changes.length + created)
      const parts = [
        changes.length > 0 ? `updated ${changes.length}` : null,
        created > 0 ? `added ${created}` : null,
      ].filter(Boolean)
      toast.push({
        kind: 'success',
        title: `Courier report applied: ${parts.join(', ')}`,
        detail: 'Buyer risk scores recomputed automatically.',
      })
      await buildPreview()
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not apply courier outcomes',
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
    }
  }

  /**
   * Turn unmatched courier rows into orders, so an order the merchant shipped
   * outside Verafo still contributes the buyer's outcome to the network.
   *
   * Idempotent: `import_ref` is derived from the courier's tracking/reference,
   * and `(store_id, import_ref)` is unique, so re-importing the same report
   * never duplicates the order.
   */
  async function createOrdersFromCourier(rows: PreviewRow[], fallbackDate: string): Promise<number> {
    if (!supabase || !storeId) return 0

    const byRef = new Map<string, PreviewRow>()
    for (const row of rows) {
      const key =
        normalizeCourierReference(row.source.trackingNumber) ||
        normalizeCourierReference(row.source.reference) ||
        `${normalizeCourierPhone(row.source.phone)}-${(row.source.resolvedAt ?? fallbackDate).slice(0, 10)}`
      if (!key) continue
      if (!byRef.has(key)) byRef.set(key, row)
    }
    const unique = [...byRef.entries()]
    if (unique.length === 0) return 0

    const phones = [...new Set(unique.map(([, row]) => canonicalPhone(row.source.phone)))]
    const { error: buyerErr } = await supabase
      .from('buyers')
      .upsert(
        phones.map((phone) => ({ phone })),
        { onConflict: 'phone', ignoreDuplicates: true },
      )
    if (buyerErr) throw buyerErr

    const payload = unique.map(([key, row]) => ({
      buyer_phone: canonicalPhone(row.source.phone),
      store_id: storeId,
      product_name: null,
      product_category: null,
      price: row.source.codAmount,
      quantity: 1,
      ordered_at: row.source.resolvedAt ?? fallbackDate,
      order_reference: row.source.reference || null,
      courier_tracking_number: row.source.trackingNumber || null,
      import_ref: `courier:${key}`,
    }))

    const { data: inserted, error: orderErr } = await supabase
      .from('orders')
      .upsert(payload, { onConflict: 'store_id,import_ref', ignoreDuplicates: true })
      .select('id, import_ref')
    if (orderErr) throw orderErr

    const created = (inserted ?? []) as { id: string; import_ref: string }[]
    if (created.length === 0) return 0

    const refToRow = new Map(unique.map(([key, row]) => [`courier:${key}`, row]))
    const { error: outcomeErr } = await supabase.from('outcomes').upsert(
      created.map((order) => {
        const row = refToRow.get(order.import_ref)
        return {
          order_id: order.id,
          status: row?.next ?? 'accepted',
          resolved_at: row?.source.resolvedAt ?? fallbackDate,
        }
      }),
      { onConflict: 'order_id' },
    )
    if (outcomeErr) throw outcomeErr

    return created.length
  }

  const tone: Record<PreviewRow['action'], string> = {
    change: 'text-foreground',
    same: 'text-muted-foreground',
    hold: 'text-muted-foreground',
    create: 'text-primary-text',
    unmatched: 'text-risk-watch-strong',
  }

  return (
    <div className="card import-card">
      <div className="import-head">
        <h3 className="card-title">
          <FileSpreadsheet size={16} /> Courier history
        </h3>
        <span className="prompt-hint">sets outcomes for dispatched orders</span>
      </div>
      <p className="import-note">
        Upload the report from your courier. Verafo finds each order and saves what happened to it.
        Orders still in transit are skipped.
      </p>

      <div className="gen-grid">
        <label className="field">
          <span className="field-label">Courier report</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void readFile(file)
              e.target.value = ''
            }}
          />
        </label>
        {/* A merchant has one store, so there is nothing to choose. Only an
            admin, who can see several, gets the picker. */}
        {stores.length > 1 && (
          <label className="field">
            <span className="field-label">Store</span>
            <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Select a store…</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {stores.length === 0 && <p className="import-note">Add a store first.</p>}

      {headers.length > 0 && (
        <>
          <p className="import-note">
            <strong>{fileName}</strong> · {cells.length} rows · {headers.length} columns. Detected:{' '}
            {headers.slice(0, 6).join(', ')}
            {headers.length > 6 ? '…' : ''}
          </p>
          <div className="import-actions">
            <button
              className="inline-flex h-10 items-center gap-2 rounded-full border border-border px-4 text-[13px] font-semibold text-foreground hover:bg-muted disabled:opacity-50"
              onClick={() => void detectWithAi()}
              disabled={aiBusy}
            >
              {aiBusy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
              {aiBusy ? 'Reading columns…' : 'Import with AI'}
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-full bg-[var(--cta-accent-bg)] px-4 text-[13px] font-semibold text-[var(--cta-accent-fg)] hover:bg-[var(--cta-accent-hover)] disabled:opacity-50"
              onClick={() => void buildPreview()}
              disabled={busy || !storeId}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <UploadCloud size={15} />}
              Match against orders
            </button>
          </div>
        </>
      )}

      {preview && (
        <div className="import-result">
          <div className="result-banner ok">
            <CheckCircle2 size={16} /> {counts.change} will change · {counts.same} already match ·{' '}
            {counts.hold} not final · {counts.create} new · {counts.unmatched} without a phone
            {imported != null ? ` · last run wrote ${imported}` : ''}
          </div>

          <div className="preview-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>reference</th>
                  <th>tracking</th>
                  <th>phone</th>
                  <th>courier status</th>
                  <th>stored</th>
                  <th>action</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 12).map((row) => (
                  <tr key={row.source.line} className={row.action === 'unmatched' ? 'row-bad' : ''}>
                    <td>{row.source.line}</td>
                    <td>{row.source.reference || '-'}</td>
                    <td>{row.source.trackingNumber || '-'}</td>
                    <td>{row.source.phone || '-'}</td>
                    <td>{row.source.status || '-'}</td>
                    <td>{row.stored ?? 'none'}</td>
                    <td className={tone[row.action]}>
                      {row.action === 'change'
                        ? `→ ${row.next}`
                        : row.action === 'same'
                          ? 'already ' + row.stored
                          : row.action === 'hold'
                            ? 'not final'
                            : row.action === 'create'
                              ? createMissing
                                ? `add as ${row.next}`
                                : 'skipped'
                              : 'no phone, skipped'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {counts.create > 0 && (
            <label className="flex items-start gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={createMissing}
                onChange={(e) => setCreateMissing(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>
                Add {counts.create} order{counts.create === 1 ? '' : 's'} with no match.
                <span className="block text-muted-foreground">
                  You shipped these outside Verafo. Adding them counts the buyer&apos;s outcome, so
                  their risk score is based on everything they did.
                </span>
              </span>
            </label>
          )}

          <div className="import-actions">
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--cta-accent-bg)] px-5 text-[13px] font-semibold text-[var(--cta-accent-fg)] hover:bg-[var(--cta-accent-hover)] disabled:opacity-50"
              onClick={() => void confirm()}
              disabled={busy || counts.change + (createMissing ? counts.create : 0) === 0}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
              {createMissing && counts.create > 0
                ? `Apply ${counts.change} + add ${counts.create}`
                : `Apply ${counts.change} outcome${counts.change === 1 ? '' : 's'}`}
            </button>
            <button
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground hover:bg-muted"
              onClick={() => {
                setPreview(null)
                setHeaders([])
                setCells([])
                setFileName('')
                setImported(null)
              }}
            >
              <XCircle size={15} /> Clear
            </button>
          </div>

          <p className="import-note">
            Matched against the most recent {MATCH_LIMIT.toLocaleString()} orders in that store.
            Rows with no phone cannot be tied to a buyer, so they are skipped.
          </p>
        </div>
      )}
    </div>
  )
}
