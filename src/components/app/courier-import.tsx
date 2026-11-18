import { useMemo, useRef, useState } from 'react'
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
import { supabase } from '@/lib/supabase'
import { useToast } from '@/lib/toast'
import type { Store } from '@/lib/types'

/** A courier row plus what it will do to the order it matched. */
interface PreviewRow {
  source: CourierRow
  orderId: string | null
  orderLabel: string
  action: 'change' | 'same' | 'hold' | 'unmatched'
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

  const counts = useMemo(() => {
    const c = { change: 0, same: 0, hold: 0, unmatched: 0 }
    for (const row of preview ?? []) c[row.action]++
    return c
  }, [preview])

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
  }

  async function buildPreview() {
    if (!supabase) return
    if (!storeId) {
      toast.push({ kind: 'error', title: 'Pick a store', detail: 'Courier rows are matched against one store.' })
      return
    }
    const parsed = parseCourierRows(headers, cells, aiMapping)
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
          return {
            source,
            orderId: null,
            orderLabel: '—',
            action: 'unmatched',
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
    if (changes.length === 0) {
      toast.push({ kind: 'info', title: 'Nothing to update', detail: 'Every matched order already has that outcome.' })
      return
    }
    setBusy(true)
    try {
      const resolvedAt = new Date().toISOString()
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

      setImported(changes.length)
      toast.push({
        kind: 'success',
        title: `Updated ${changes.length} order${changes.length === 1 ? '' : 's'}`,
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

  const tone: Record<PreviewRow['action'], string> = {
    change: 'text-foreground',
    same: 'text-muted-foreground',
    hold: 'text-muted-foreground',
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
        Upload the report your courier gives you (CSV or Excel). Verafo matches each row to an
        existing order by reference, then tracking number, then phone — and writes the delivery
        outcome. Rows without a final status (in transit, undelivered, attempted) are never written.
      </p>

      <div className="gen-grid">
        <label className="field">
          <span className="field-label">Store</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">{stores.length === 0 ? 'No stores yet' : 'Select a store…'}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
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
      </div>

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
            {counts.hold} not final · {counts.unmatched} unmatched
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
                    <td>{row.source.reference || '—'}</td>
                    <td>{row.source.trackingNumber || '—'}</td>
                    <td>{row.source.phone || '—'}</td>
                    <td>{row.source.status || '—'}</td>
                    <td>{row.stored ?? 'none'}</td>
                    <td className={tone[row.action]}>
                      {row.action === 'change'
                        ? `→ ${row.next}`
                        : row.action === 'same'
                          ? 'already ' + row.stored
                          : row.action === 'hold'
                            ? 'not final'
                            : 'no matching order'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="import-actions">
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--cta-accent-bg)] px-5 text-[13px] font-semibold text-[var(--cta-accent-fg)] hover:bg-[var(--cta-accent-hover)] disabled:opacity-50"
              onClick={() => void confirm()}
              disabled={busy || counts.change === 0}
            >
              {busy ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
              Apply {counts.change} outcome{counts.change === 1 ? '' : 's'}
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
            Unmatched rows usually mean the order was never logged in Verafo.
          </p>
        </div>
      )}
    </div>
  )
}
