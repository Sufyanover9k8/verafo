import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { AlertCircle, CheckCircle2, CloudUpload, FileSpreadsheet, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseCsv } from '../lib/ui/order-csv'
import { courierOutcome, normalizeCourierPhone, normalizeCourierReference, parseCourierRows, type CourierRow } from '../lib/ui/courier-reconciliation'
import { mapCourierColumnsWithAi } from '../lib/ui/ai-column-map'
import { notificationsChanged } from '../lib/notifications'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'

type StoreOption = { id: string; name: string }
type ExistingOrder = {
  id: string
  store_id: string
  buyer_phone: string | null
  price: number | string | null
  product_name: string | null
  ordered_at: string | null
  order_reference: string | null
  shopify_order_id: string | null
  courier_tracking_number: string | null
  stores: { name: string } | null
  outcomes: { status: string; resolved_at: string | null } | { status: string; resolved_at: string | null }[] | null
}
type PreviewRow = { source: CourierRow; outcome: 'accepted' | 'refused' | 'pending' | null; order: ExistingOrder | null; reason: string }

function normalizedText(v: unknown) { return String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') }
function outcomeOf(order: ExistingOrder) {
  return Array.isArray(order.outcomes) ? order.outcomes[0] : order.outcomes
}

export function CourierImport({ stores }: { stores: StoreOption[] }) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<CourierRow[]>([])
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<{ updated: number; review: number; unchanged: number; failed: string[] } | null>(null)

  const summary = useMemo(() => {
    const p = preview ?? []
    return {
      matched: p.filter((x) => x.order && (x.outcome === 'accepted' || x.outcome === 'refused')).length,
      review: p.filter((x) => !x.order || !x.outcome || x.outcome === 'pending').length,
    }
  }, [preview])

  async function readFile(file: File) {
    setBusy(true); setResult(null); setPreview(null); setFileName(file.name)
    try {
      let grid: unknown[][]
      if (/\.xlsx?$/i.test(file.name)) {
        const bytes = await file.arrayBuffer()
        const workbook = XLSX.read(bytes, { type: 'array', cellDates: true })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][]
      } else {
        const text = await file.text()
        grid = parseCsv(text)
      }
      if (grid.length < 2) throw new Error('This file has no data rows.')
      const headers = grid[0].map((x) => String(x ?? '').trim())
      let parsed = parseCourierRows(headers, grid.slice(1))
      // Only spend an AI call when common aliases could not extract any matching identifier.
      if (!parsed.some((r) => r.reference || r.trackingNumber || r.phone)) {
        try {
          const aiColumns = await mapCourierColumnsWithAi(headers, grid.slice(1))
          if (aiColumns) parsed = parseCourierRows(headers, grid.slice(1), aiColumns)
        } catch {
          // Deterministic parsing remains available; unmatched records stay for review.
        }
      }
      if (!parsed.length) throw new Error('No usable courier rows were found. Check that the first row contains column headers.')
      if (!headers.some((h) => /status|outcome|delivery/i.test(h))) throw new Error('Could not identify a delivery-status column in this file.')
      setRows(parsed)
      toast.push({ kind: 'success', title: 'Courier file read', detail: `${parsed.length} courier rows detected. Next, preview the matches.` })
    } catch (error) {
      setRows([])
      toast.push({ kind: 'error', title: 'Could not read courier file', detail: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  async function previewMatches() {
    if (!supabase) return
    if (!rows.length) return
    if (!stores.length) {
      toast.push({ kind: 'error', title: 'No stores available', detail: 'Choose or connect a store before importing a courier report.' }); return
    }
    setBusy(true); setResult(null)
    try {
      const db = supabase as any
      const { data, error } = await db.from('orders')
        .select('id, store_id, buyer_phone, price, product_name, ordered_at, order_reference, shopify_order_id, courier_tracking_number, stores(name), outcomes(status, resolved_at)')
        .in('store_id', stores.map((s) => s.id))
        .limit(10000)
      if (error) throw error
      const orders = (data ?? []) as unknown as ExistingOrder[]
      const seen = new Set<string>()
      const planned: PreviewRow[] = rows.map((source) => {
        const wantedStore = normalizedText(source.store)
        let scopedStores = stores
        if (wantedStore) {
          const exact = stores.filter((s) => normalizedText(s.name) === wantedStore)
          const partial = exact.length ? exact : stores.filter((s) => normalizedText(s.name).includes(wantedStore) || wantedStore.includes(normalizedText(s.name)))
          if (partial.length) scopedStores = partial
          else if (stores.length > 1) return { source, outcome: courierOutcome(source.status, source.reason), order: null, reason: `Courier shipper “${source.store}” did not match a store` }
        } else if (stores.length > 1) {
          return { source, outcome: courierOutcome(source.status, source.reason), order: null, reason: 'No store/shipper column value; select a report with a store identifier' }
        }
        const storeIds = new Set(scopedStores.map((s) => s.id))
        const candidates = orders.filter((o) => storeIds.has(o.store_id))
        let matches: ExistingOrder[] = []
        const ref = normalizeCourierReference(source.reference)
        const tracking = normalizeCourierReference(source.trackingNumber)
        if (ref) matches = candidates.filter((o) => normalizeCourierReference(o.order_reference) === ref || normalizeCourierReference(o.shopify_order_id) === ref)
        if (matches.length !== 1 && tracking) matches = candidates.filter((o) => normalizeCourierReference(o.courier_tracking_number) === tracking)
        if (matches.length !== 1 && source.phone) {
          matches = candidates.filter((o) => normalizeCourierPhone(o.buyer_phone) === normalizeCourierPhone(source.phone))
          if (matches.length > 1 && source.codAmount != null) {
            const amountMatches = matches.filter((o) => o.price != null && Math.abs(Number(o.price) - source.codAmount!) < 1)
            if (amountMatches.length) matches = amountMatches
          }
        }
        const outcome = courierOutcome(source.status, source.reason)
        if (matches.length !== 1) return { source, outcome, order: null, reason: matches.length > 1 ? `${matches.length} possible orders; manual review required` : 'No existing order matched this row' }
        const order = matches[0]
        if (seen.has(order.id)) return { source, outcome, order: null, reason: 'Another courier row already matched this order in this upload; review duplicate shipment rows' }
        seen.add(order.id)
        if (!outcome || outcome === 'pending') return { source, outcome, order, reason: 'Status is not a confirmed final outcome; no automatic update' }
        return { source, outcome, order, reason: 'Matched' }
      })
      setPreview(planned)
      toast.push({ kind: 'success', title: 'Preview ready', detail: `${planned.filter((x) => x.order && (x.outcome === 'accepted' || x.outcome === 'refused')).length} final outcomes are eligible for update; uncertain rows will be left unchanged.` })
    } catch (error) {
      toast.push({ kind: 'error', title: 'Could not match courier rows', detail: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  async function applyUpdates() {
    if (!supabase || !preview) return
    const eligible = preview.filter((x) => x.order && (x.outcome === 'accepted' || x.outcome === 'refused'))
    if (!eligible.length) {
      toast.push({ kind: 'error', title: 'No safe updates to apply', detail: 'All rows need review or have non-final statuses.' }); return
    }
    setConfirming(true)
    let updated = 0, unchanged = 0
    const failed: string[] = []
    try {
      for (const item of eligible) {
        const order = item.order!
        try {
          const current = outcomeOf(order)?.status
          if (current === item.outcome) { unchanged++; continue }
          const { error: outcomeError } = await supabase.from('outcomes').upsert({
            order_id: order.id,
            status: item.outcome,
            resolved_at: item.source.resolvedAt ?? new Date().toISOString(),
          }, { onConflict: 'order_id' })
          if (outcomeError) throw outcomeError
          if (item.source.trackingNumber && !order.courier_tracking_number) {
            const { error: trackingError } = await (supabase as any).from('orders').update({ courier_tracking_number: item.source.trackingNumber }).eq('id', order.id)
            if (trackingError) throw trackingError
          }
          updated++
        } catch (error) { failed.push(`Line ${item.source.line}: ${error instanceof Error ? error.message : String(error)}`) }
      }
      notificationsChanged()
      setResult({ updated, review: preview.length - eligible.length, unchanged, failed })
      toast.push({ kind: failed.length ? 'error' : 'success', title: `Courier reconciliation finished`, detail: `${updated} outcomes updated, ${unchanged} already current, ${preview.length - eligible.length} rows left for review.` })
    } finally { setConfirming(false) }
  }

  return <section className="rounded-[16px] border border-border bg-card p-6">
    <div className="mb-3 flex items-center gap-2"><FileSpreadsheet className="size-4 text-primary-text" /><h2 className="text-[15px] font-semibold text-foreground">Import courier delivery report</h2></div>
    <p className="mb-4 text-[13px] text-muted-foreground">Upload a courier CSV or Excel file after importing Shopify orders. Verafo matches by order reference or tracking number first, then uses phone number within the store only when the match is unique. Ambiguous and non-final statuses are not changed.</p>
    <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void readFile(file); e.currentTarget.value = '' }} />
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" className="h-10 gap-2" onClick={() => fileRef.current?.click()} disabled={busy || confirming}><CloudUpload className="size-4" /> Choose courier file</Button>
      {fileName && <span className="max-w-full truncate text-[12px] text-muted-foreground">{fileName} · {rows.length} rows</span>}
      <Button className="h-10" onClick={() => void previewMatches()} disabled={!rows.length || busy || confirming}>{busy ? <><Loader2 className="me-2 size-4 animate-spin"/>Working…</> : 'Preview matches'}</Button>
    </div>
    {preview && <div className="mt-5 space-y-3">
      <p className="text-[13px] text-foreground"><strong>{summary.matched}</strong> safe final updates · <strong>{summary.review}</strong> rows need review or are non-final.</p>
      <div className="max-h-[420px] overflow-auto rounded-lg border border-border"><table className="w-full text-left text-[12px]"><thead className="sticky top-0 bg-muted"><tr>{['Line','Courier status','Phone / reference','Matched order','Action'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead><tbody>{preview.slice(0, 250).map((item) => <tr key={`${item.source.line}-${item.source.trackingNumber}`} className="border-t border-border"><td className="px-3 py-2">{item.source.line}</td><td className="px-3 py-2">{item.source.status || '—'}</td><td className="px-3 py-2">{item.source.phone || item.source.reference || item.source.trackingNumber || '—'}</td><td className="px-3 py-2">{item.order ? `${item.order.stores?.name ?? 'Store'} · ${item.order.product_name ?? item.order.id.slice(0, 8)}` : '—'}</td><td className="px-3 py-2"><span className={item.order && (item.outcome === 'accepted' || item.outcome === 'refused') ? 'text-risk-safe-strong' : 'text-risk-high-strong'}>{item.reason}{item.outcome && item.outcome !== 'pending' ? ` (${item.outcome})` : ''}</span></td></tr>)}</tbody></table></div>
      {preview.length > 250 && <p className="text-[12px] text-muted-foreground">Showing first 250 of {preview.length} rows. All rows are included in the update calculation.</p>}
      <Button onClick={() => void applyUpdates()} disabled={confirming || summary.matched === 0} className="h-10">{confirming ? <><Loader2 className="me-2 size-4 animate-spin"/>Applying…</> : `Confirm ${summary.matched} outcome updates`}</Button>
    </div>}
    {result && <div className="mt-4 rounded-lg border border-border p-3 text-[13px]"><p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-risk-safe-strong"/>Updated {result.updated}; already current {result.unchanged}; left for review {result.review}; failed {result.failed.length}.</p>{result.failed.length > 0 && <ul className="mt-2 list-disc ps-5 text-risk-high-strong">{result.failed.slice(0, 10).map((x) => <li key={x}>{x}</li>)}</ul>}</div>}
    <p className="mt-3 flex items-start gap-2 text-[11.5px] text-muted-foreground"><AlertCircle className="mt-0.5 size-3.5 shrink-0"/>The notification database trigger is reused when outcomes change. A row with a generic “UnDelivered” or “In Transit” status stays unchanged until a final status is supplied.</p>
  </section>
}
