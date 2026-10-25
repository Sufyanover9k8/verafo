import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { AlertCircle, CheckCircle2, CloudUpload, FileSpreadsheet, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseCsv } from '../lib/ui/order-csv'
import {
  courierOutcome,
  courierUpdateAction,
  normalizeCourierPhone,
  normalizeCourierReference,
  normalizeStoredOutcome,
  parseCourierRows,
  type CourierOutcome,
  type CourierRow,
  type CourierUpdateAction,
  type StoredOutcome,
} from '../lib/ui/courier-reconciliation'
import { mapCourierColumnsWithAi } from '../lib/ui/ai-column-map'
import { softDeleteReady } from '../lib/ui/order-visibility'
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
/** `change` writes, `same` is already in the database, `review` is never written. */
type PreviewTone = 'change' | 'same' | 'review'
type PreviewRow = {
  source: CourierRow
  outcome: CourierOutcome
  order: ExistingOrder | null
  /** What `outcomes.status` holds right now for the matched order. */
  stored: StoredOutcome
  action: CourierUpdateAction
  tone: PreviewTone
  reason: string
}

function normalizedText(v: unknown) { return String(v ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '') }
function outcomeOf(order: ExistingOrder) {
  return Array.isArray(order.outcomes) ? order.outcomes[0] : order.outcomes
}

/**
 * One row's plan, in the merchant's words.
 *
 * The important case is `same`: before this existed, a row whose stored outcome
 * already equalled the courier's outcome was counted as a "safe final update",
 * the button promised work, and pressing it wrote nothing at all.
 */
function planRow(args: {
  source: CourierRow
  outcome: CourierOutcome
  order: ExistingOrder | null
  stored: StoredOutcome
  blockedReason?: string
}): PreviewRow {
  const { source, outcome, order, stored, blockedReason } = args
  if (!order) {
    return { source, outcome, order, stored, action: 'hold', tone: 'review', reason: blockedReason ?? 'No existing order matched this row' }
  }
  if (blockedReason) {
    return { source, outcome, order, stored, action: 'hold', tone: 'review', reason: blockedReason }
  }
  const action = courierUpdateAction(outcome, stored)
  if (action === 'hold') {
    const status = source.status || 'This status'
    return { source, outcome, order, stored, action, tone: 'review', reason: `“${status}” is not a final delivery status — left unchanged` }
  }
  if (action === 'already') {
    return { source, outcome, order, stored, action, tone: 'same', reason: `Already ${stored} — nothing to change` }
  }
  return {
    source,
    outcome,
    order,
    stored,
    action,
    tone: 'change',
    reason: `Will set ${outcome} — ${stored ? `currently ${stored}` : 'no outcome yet'}`,
  }
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

  /**
   * Three numbers that must always agree with what the button will do: how many
   * rows the write loop will actually change, how many already match the
   * report, and how many are held back for review.
   */
  const summary = useMemo(() => {
    const p = preview ?? []
    const toUpdate = p.filter((x) => x.action === 'update').length
    const already = p.filter((x) => x.action === 'already').length
    return { toUpdate, already, review: p.length - toUpdate - already }
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
      /*
       * Hidden ("deleted") orders must not take part in matching. `Delete` on the
       * Orders screen only stamps `orders.deleted_at`, so every other list hides
       * those rows — and a courier row that was ambiguous only because of hidden
       * duplicates looked like a phantom: "6 possible orders" on a store whose
       * Outcomes screen showed none of them.
       */
      const hiddenRowsExcluded = await softDeleteReady()
      const db = supabase as any
      const base = db.from('orders')
        .select('id, store_id, buyer_phone, price, product_name, ordered_at, order_reference, shopify_order_id, courier_tracking_number, stores(name), outcomes(status, resolved_at)')
        .in('store_id', stores.map((s) => s.id))
      const { data, error } = await (hiddenRowsExcluded ? base.is('deleted_at', null) : base).limit(10000)
      if (error) throw error
      const orders = (data ?? []) as unknown as ExistingOrder[]
      const seen = new Set<string>()
      /** Pass 1 — decide which order each courier line is about. */
      const matched = rows.map((source) => {
        const outcome = courierOutcome(source.status, source.reason)
        const wantedStore = normalizedText(source.store)
        let scopedStores = stores
        if (wantedStore) {
          const exact = stores.filter((s) => normalizedText(s.name) === wantedStore)
          const partial = exact.length ? exact : stores.filter((s) => normalizedText(s.name).includes(wantedStore) || wantedStore.includes(normalizedText(s.name)))
          if (partial.length) scopedStores = partial
          else if (stores.length > 1) return { source, outcome, order: null as ExistingOrder | null, blockedReason: `Courier shipper “${source.store}” did not match a store` }
        } else if (stores.length > 1) {
          return { source, outcome, order: null as ExistingOrder | null, blockedReason: 'No store/shipper column value; select a report with a store identifier' }
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
        if (matches.length !== 1) {
          return {
            source,
            outcome,
            order: null as ExistingOrder | null,
            blockedReason: matches.length > 1
              ? `${matches.length} orders share this phone — check Orders before importing`
              : 'No visible order matched this row',
          }
        }
        const order = matches[0]
        if (seen.has(order.id)) {
          return { source, outcome, order, blockedReason: 'Another courier row already matched this order in this upload; review duplicate shipment rows' }
        }
        seen.add(order.id)
        return { source, outcome, order, blockedReason: undefined }
      })

      /*
       * Ask the `outcomes` table itself what each matched order holds. Reading it
       * directly (rather than only through the nested embed, which can come back
       * as an object, an array or null depending on the relationship) is what
       * lets the preview say "already accepted — nothing to change" truthfully.
       */
      const storedByOrder = new Map<string, StoredOutcome>()
      let liveRead = false
      const matchedIds = [...new Set(matched.map((m) => m.order?.id).filter((id): id is string => Boolean(id)))]
      if (matchedIds.length) {
        try {
          const { data: live, error: liveError } = await supabase
            .from('outcomes')
            .select('order_id, status')
            .in('order_id', matchedIds)
          if (liveError) throw liveError
          for (const row of (live ?? []) as unknown as { order_id: string; status: string }[]) {
            storedByOrder.set(row.order_id, normalizeStoredOutcome(row.status))
          }
          liveRead = true
        } catch {
          // Fall back to the embedded outcome below.
        }
      }

      /** Pass 2 — turn each match into an action the merchant can read. */
      const planned: PreviewRow[] = matched.map((entry) => {
        const order = entry.order
        let stored: StoredOutcome = null
        if (order) {
          stored = storedByOrder.has(order.id)
            ? storedByOrder.get(order.id) ?? null
            : liveRead
              ? null // the outcomes table answered and has no row for this order
              : normalizeStoredOutcome(outcomeOf(order)?.status) // the read failed — use the embed
        }
        return planRow({ source: entry.source, outcome: entry.outcome, order, stored, blockedReason: entry.blockedReason })
      })
      setPreview(planned)
      const toUpdate = planned.filter((x) => x.action === 'update').length
      const already = planned.filter((x) => x.action === 'already').length
      toast.push({
        kind: toUpdate ? 'success' : 'info',
        title: 'Preview ready',
        detail: toUpdate
          ? `${toUpdate} outcome${toUpdate === 1 ? '' : 's'} will change${already ? `; ${already} already match${already === 1 ? 'es' : ''} this report` : ''}. Rows with no unique match stay unchanged.`
          : already
            ? `No outcome needs changing — the ${already} matched order${already === 1 ? '' : 's'} already hold${already === 1 ? 's' : ''} exactly these outcomes.`
            : 'No row in this file can be applied automatically; unmatched and non-final rows are left for review.',
      })
    } catch (error) {
      toast.push({ kind: 'error', title: 'Could not match courier rows', detail: error instanceof Error ? error.message : String(error) })
    } finally { setBusy(false) }
  }

  async function applyUpdates() {
    if (!supabase || !preview) return
    const eligible = preview.filter((x) => x.action === 'update' && x.order)
    if (!eligible.length) {
      toast.push({ kind: 'info', title: 'Nothing to update', detail: 'Every matched order already holds the outcome in this report; unmatched and non-final rows are left for review.' }); return
    }
    setConfirming(true)
    let updated = 0
    let unchanged = 0
    const failed: string[] = []
    const applied = new Map<string, 'accepted' | 'refused'>()
    // Rows that were never writable (no unique match, non-final status, duplicate
    // shipment) are the ones "left for review" — an already-current row is not.
    const alreadyBefore = preview.filter((x) => x.action === 'already').length
    const review = preview.length - eligible.length - alreadyBefore
    try {
      /*
       * Re-read the statuses this run is about to touch. The preview snapshot can
       * be minutes old, and an outcome written from the Outcomes screen in the
       * meantime must not be reported as "skipped" (or overwritten blind).
       */
      const fresh = new Map<string, StoredOutcome>()
      try {
        const { data: live } = await supabase
          .from('outcomes')
          .select('order_id, status')
          .in('order_id', eligible.map((x) => x.order!.id))
        for (const row of (live ?? []) as unknown as { order_id: string; status: string }[]) {
          fresh.set(row.order_id, normalizeStoredOutcome(row.status))
        }
      } catch {
        // A failed read is not a reason to refuse the write; fall back to the
        // preview snapshot below.
      }

      for (const item of eligible) {
        const order = item.order!
        const target = item.outcome as 'accepted' | 'refused'
        const live = fresh.has(order.id) ? fresh.get(order.id) ?? null : item.stored
        if (live === target) { unchanged++; continue }
        try {
          const { error: outcomeError } = await supabase.from('outcomes').upsert({
            order_id: order.id,
            status: target,
            resolved_at: item.source.resolvedAt ?? new Date().toISOString(),
          }, { onConflict: 'order_id' })
          if (outcomeError) throw outcomeError
          if (item.source.trackingNumber && !order.courier_tracking_number) {
            const { error: trackingError } = await (supabase as any).from('orders').update({ courier_tracking_number: item.source.trackingNumber }).eq('id', order.id)
            if (trackingError) throw trackingError
          }
          applied.set(order.id, target)
          updated++
        } catch (error) { failed.push(`Line ${item.source.line}: ${error instanceof Error ? error.message : String(error)}`) }
      }

      /*
       * Rewrite the rows we just wrote so the table cannot keep advertising
       * updates that are now in the database. Without this the section looked
       * identical before and after a successful run — the exact "I clicked and
       * nothing happened" report.
       */
      setPreview((current) => (current ?? []).map((row) => {
        const target = row.order ? applied.get(row.order.id) : undefined
        if (!target) return row
        return { ...row, stored: target, action: 'already' as const, tone: 'same' as const, reason: `Already ${target} — nothing to change` }
      }))
      notificationsChanged()
      setResult({ updated, review, unchanged, failed })
      if (updated === 0) {
        toast.push({
          kind: 'info',
          title: 'Nothing needed changing',
          detail: `${unchanged} matched order${unchanged === 1 ? '' : 's'} already hold${unchanged === 1 ? 's' : ''} these outcomes; ${review} row${review === 1 ? '' : 's'} left for review.`,
        })
      } else {
        toast.push({
          kind: failed.length ? 'error' : 'success',
          title: 'Courier reconciliation finished',
          detail: `${updated} outcome${updated === 1 ? '' : 's'} updated${unchanged ? `, ${unchanged} already current` : ''}, ${review} row${review === 1 ? '' : 's'} left for review.`,
        })
      }
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
      <p className="text-[13px] text-foreground">
        <strong>{summary.toUpdate}</strong> outcome update{summary.toUpdate === 1 ? '' : 's'} ready ·{' '}
        <strong>{summary.already}</strong> already current ·{' '}
        <strong>{summary.review}</strong> row{summary.review === 1 ? '' : 's'} {summary.review === 1 ? 'needs' : 'need'} review or {summary.review === 1 ? 'is' : 'are'} non-final.
      </p>
      <div className="max-h-[420px] overflow-auto rounded-lg border border-border"><table className="w-full text-left text-[12px]"><thead className="sticky top-0 bg-muted"><tr>{['Line','Courier status','Phone / reference','Matched order','Action'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead><tbody>{preview.slice(0, 250).map((item) => <tr key={`${item.source.line}-${item.source.trackingNumber}`} className="border-t border-border"><td className="px-3 py-2">{item.source.line}</td><td className="px-3 py-2">{item.source.status || '—'}</td><td className="px-3 py-2">{item.source.phone || item.source.reference || item.source.trackingNumber || '—'}</td><td className="px-3 py-2">{item.order ? `${item.order.stores?.name ?? 'Store'} · ${item.order.product_name ?? item.order.id.slice(0, 8)}` : '—'}</td><td className="px-3 py-2"><span className={item.tone === 'change' ? 'text-risk-safe-strong' : item.tone === 'same' ? 'text-muted-foreground' : 'text-risk-high-strong'}>{item.reason}</span></td></tr>)}</tbody></table></div>
      {preview.length > 250 && <p className="text-[12px] text-muted-foreground">Showing first 250 of {preview.length} rows. All rows are included in the update calculation.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void applyUpdates()} disabled={confirming || summary.toUpdate === 0} className="h-10">{confirming ? <><Loader2 className="me-2 size-4 animate-spin"/>Applying…</> : summary.toUpdate === 0 ? 'Nothing to update' : `Confirm ${summary.toUpdate} outcome update${summary.toUpdate === 1 ? '' : 's'}`}</Button>
        {summary.toUpdate === 0 && <p className="text-[12px] text-muted-foreground">{summary.already > 0 ? `The ${summary.already} matched order${summary.already === 1 ? '' : 's'} already hold${summary.already === 1 ? 's' : ''} exactly these outcomes — there is nothing to write.` : 'No row in this file can be applied automatically.'}</p>}
      </div>
    </div>}
    {result && <div className="mt-4 rounded-lg border border-border p-3 text-[13px]"><p className="flex items-center gap-2"><CheckCircle2 className="size-4 text-risk-safe-strong"/>Updated {result.updated}; already current {result.unchanged}; left for review {result.review}; failed {result.failed.length}.</p>{result.updated === 0 && result.failed.length === 0 && <p className="mt-1 text-[12.5px] text-muted-foreground">Every matched order already held this outcome, so nothing was written to the database.</p>}{result.failed.length > 0 && <ul className="mt-2 list-disc ps-5 text-risk-high-strong">{result.failed.slice(0, 10).map((x) => <li key={x}>{x}</li>)}</ul>}</div>}
    <p className="mt-3 flex items-start gap-2 text-[11.5px] text-muted-foreground"><AlertCircle className="mt-0.5 size-3.5 shrink-0"/>The notification database trigger is reused when outcomes change. A row with a generic “UnDelivered” or “In Transit” status stays unchanged until a final status is supplied.</p>
  </section>
}
