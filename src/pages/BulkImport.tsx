import { useEffect, useMemo, useRef, useState } from 'react'
import { useIsAdmin } from '../lib/admin'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Reveal } from '../components/Reveal'
import { NeedsSetup } from '../components/States'
import { money } from '../lib/format'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { Store } from '../lib/types'
import { CourierImport } from '../components/app/courier-import'
import { CourierSettings } from '../components/app/courier-settings'
import {
  failedRowsCsv,
  parseImport,
  stripBom,
  TEMPLATE_COLUMNS,
  TEMPLATE_CSV,
  type ParsedRow,
} from '../lib/ui/import'

/** Rows per network round-trip. Big enough to be fast, small enough to retry. */
const CHUNK_SIZE = 200
/** Refuse absurd files before the browser tries to upload them. */
const MAX_ROWS = 20000

interface Failure {
  line: number
  reason: string
}

interface ImportResult {
  imported: number
  skipped: number
  failed: Failure[]
  total: number
}

export function BulkImport() {
  const toast = useToast()
  const { admin } = useIsAdmin()
  const { role, stores: myStores } = useStoreScope()
  const [stores, setStores] = useState<Store[]>([])
  const [text, setText] = useState('')
  const [storeId, setStoreId] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [genStores, setGenStores] = useState(3)
  const [genBuyers, setGenBuyers] = useState(5)
  const [genOrders, setGenOrders] = useState(6)
  const [genMix, setGenMix] = useState<'safe' | 'balanced' | 'risky'>('balanced')
  const [genBusy, setGenBusy] = useState(false)
  const [genResult, setGenResult] = useState<{
    stores: number
    buyers: number
    orders: number
    refused: number
    pending: number
    accepted: number
  } | null>(null)

  useEffect(() => {
    if (!supabase) return
    // Merchants can only import into their own store(s).
    if (role !== 'admin') {
      setStores(myStores.map((s) => ({ id: s.id, name: s.name })) as Store[])
      return
    }
    supabase
      .from('stores')
      .select('id, name')
      .then(({ data, error }) => {
        if (!error) setStores((data ?? []) as Store[])
      })
  }, [role, myStores])

  // Default the picker to the only store, so single-store merchants never
  // think about it — and admins always see which store they are writing to.
  useEffect(() => {
    if (storeId && stores.some((s) => s.id === storeId)) return
    setStoreId(stores.length === 1 ? stores[0].id : '')
  }, [stores, storeId])

  const parsed = useMemo(() => parseImport(text), [text])

  const storesByName = useMemo(() => {
    const map = new Map<string, Store[]>()
    for (const s of stores) {
      const key = s.name.trim().toLowerCase()
      const list = map.get(key)
      if (list) list.push(s)
      else map.set(key, [s])
    }
    return map
  }, [stores])

  /** Which store a row belongs to, and why it might be ambiguous. */
  const resolveStore = useMemo(() => {
    return (row: ParsedRow): { store: Store | null; reason: string | null } => {
      const name = row.store.trim().toLowerCase()
      if (name) {
        const matches = storesByName.get(name) ?? []
        if (matches.length === 1) return { store: matches[0], reason: null }
        if (matches.length > 1) {
          return {
            store: null,
            reason: `${matches.length} stores are named "${row.store}" — pick the store above instead of using the store column`,
          }
        }
        return { store: null, reason: `unknown store "${row.store}"` }
      }
      const picked = stores.find((s) => s.id === storeId) ?? null
      if (picked) return { store: picked, reason: null }
      return { store: null, reason: 'no store selected and the row has no store column' }
    }
  }, [storesByName, stores, storeId])

  const rowChecks = useMemo(
    () => parsed.rows.map((r) => ({ row: r, ...resolveStore(r) })),
    [parsed.rows, resolveStore],
  )

  const readyRows = useMemo(
    () => rowChecks.filter((r) => r.row.errors.length === 0 && r.store !== null),
    [rowChecks],
  )

  const blockedCount = rowChecks.length - readyRows.length

  const duplicateRefs = useMemo(() => {
    const seen = new Set<string>()
    let dupes = 0
    for (const { row } of rowChecks) {
      if (row.errors.length > 0) continue
      if (seen.has(row.importRef)) dupes++
      else seen.add(row.importRef)
    }
    return dupes
  }, [rowChecks])

  const preview = rowChecks.slice(0, 6)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 25 * 1024 * 1024) {
      toast.push({ kind: 'error', title: 'File too large', detail: 'Split it into files under 25 MB.' })
      e.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      // Excel sometimes writes UTF-16; stripBom + the parser handle UTF-8 and
      // UTF-16LE BOMs, and anything else degrades to readable ASCII.
      const buf = reader.result
      setText(typeof buf === 'string' ? stripBom(buf) : '')
    }
    reader.readAsText(f)
    e.target.value = ''
  }

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(TEMPLATE_CSV)
      toast.push({
        kind: 'success',
        title: 'Template copied',
        detail: 'Paste it into any AI tool to generate dummy data in this exact format.',
      })
    } catch {
      toast.push({ kind: 'error', title: 'Copy failed', detail: 'Copy the text below manually.' })
    }
  }

  async function generateDummy() {
    const base = functionsBaseUrl()
    if (!supabase || !base) return
    setGenBusy(true)
    setGenResult(null)
    try {
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-dummy',
          stores: Math.max(1, Math.min(5, genStores)),
          buyers_per_store: Math.max(1, Math.min(6, genBuyers)),
          orders_per_buyer: Math.max(2, Math.min(8, genOrders)),
          mix: genMix,
        }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        summary?: { stores: number; buyers: number; orders: number; refused: number; pending: number; accepted: number }
        error?: string
      }
      if (!res.ok || !json.ok || !json.summary) throw new Error(json.error ?? 'Request failed')
      setGenResult(json.summary)
      toast.push({
        kind: 'success',
        title: 'Dummy data generated',
        detail: `${json.summary.stores} stores, ${json.summary.buyers} buyers, ${json.summary.orders} orders. Scores computed automatically.`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({
        kind: 'error',
        title: 'Generation failed',
        detail: `${message} — is the verafo-ai edge function deployed with an OpenAI key?`,
      })
    } finally {
      setGenBusy(false)
    }
  }

  function orderPayload(row: ParsedRow, store: Store) {
    return {
      buyer_phone: row.phone,
      store_id: store.id,
      product_category: row.category || null,
      product_name: row.product || null,
      price: row.price,
      quantity: row.quantity,
      address: row.address || null,
      city: row.city || null,
      // Omitting the key lets the column default to now().
      ...(row.orderedAt ? { ordered_at: row.orderedAt } : {}),
      import_ref: row.importRef,
    }
  }

  async function runImport() {
    if (!supabase) return
    if (parsed.fileErrors.length > 0) {
      toast.push({ kind: 'error', title: 'Nothing to import', detail: parsed.fileErrors.join(' · ') })
      return
    }
    if (readyRows.length === 0) {
      toast.push({
        kind: 'error',
        title: 'Nothing to import',
        detail: blockedCount > 0 ? `${blockedCount} row(s) need fixing first.` : 'No valid rows.',
      })
      return
    }
    if (readyRows.length > MAX_ROWS) {
      toast.push({
        kind: 'error',
        title: 'File too large',
        detail: `Split it into files of ${MAX_ROWS.toLocaleString()} rows or fewer.`,
      })
      return
    }

    setImporting(true)
    setResult(null)
    setProgress({ done: 0, total: readyRows.length })

    const failed: Failure[] = []
    let imported = 0
    let skipped = 0

    for (let offset = 0; offset < readyRows.length; offset += CHUNK_SIZE) {
      const chunk = readyRows.slice(offset, offset + CHUNK_SIZE)
      const chunkResult = await importChunk(chunk)
      imported += chunkResult.imported
      skipped += chunkResult.skipped
      failed.push(...chunkResult.failed)
      setProgress({ done: offset + chunk.length, total: readyRows.length })
    }

    setImporting(false)
    setResult({ imported, skipped, failed, total: readyRows.length })
    toast.push({
      kind: failed.length > 0 ? 'error' : 'success',
      title: `Imported ${imported} order${imported === 1 ? '' : 's'}`,
      detail:
        (skipped > 0 ? `${skipped} already in Verafo, ` : '') +
        (failed.length > 0 ? `${failed.length} failed — see the list below.` : 'Scores recomputed automatically.'),
    })
  }

  /** Import one chunk: 3 statements instead of 3 per row. */
  async function importChunk(
    chunk: { row: ParsedRow; store: Store | null }[],
  ): Promise<{ imported: number; skipped: number; failed: Failure[] }> {
    if (!supabase) return { imported: 0, skipped: 0, failed: [] }
    const client = supabase
    const failed: Failure[] = []
    const usable = chunk.filter((c): c is { row: ParsedRow; store: Store } => c.store !== null)

    // One buyer upsert for the chunk. ignoreDuplicates keeps existing totals.
    const phones = [...new Set(usable.map((c) => c.row.phone))]
    const { error: buyerErr } = await client
      .from('buyers')
      .upsert(
        phones.map((phone) => ({ phone })),
        { onConflict: 'phone', ignoreDuplicates: true },
      )

    if (buyerErr) {
      // Fall back to per-row so one bad phone cannot sink the whole chunk.
      return importRowByRow(usable)
    }

    const byRef = new Map<string, { row: ParsedRow; store: Store }>()
    for (const c of usable) byRef.set(`${c.store.id}:${c.row.importRef}`, c)

    const payload = usable.map((c) => orderPayload(c.row, c.store))
    const { data: inserted, error: orderErr } = await client
      .from('orders')
      .upsert(payload, { onConflict: 'store_id,import_ref', ignoreDuplicates: true })
      .select('id, import_ref, store_id')

    if (orderErr) return importRowByRow(usable)

    const rows = (inserted ?? []) as { id: string; import_ref: string; store_id: string }[]
    const skipped = usable.length - rows.length
    const imported = rows.length

    // Outcomes only for the orders this run actually created, so a re-import
    // never overwrites an outcome a merchant has since edited.
    const lineById = new Map<string, number>()
    const outcomeRows: { order_id: string; status: string; resolved_at: string | null }[] = []
    for (const o of rows) {
      const match = byRef.get(`${o.store_id}:${o.import_ref}`)
      if (!match) continue
      lineById.set(o.id, match.row.line)
      const r = match.row
      if (r.outcome === 'pending' && !r.resolvedAt) continue
      outcomeRows.push({
        order_id: o.id,
        status: r.outcome,
        resolved_at: r.resolvedAt ?? (r.outcome === 'pending' ? null : new Date().toISOString()),
      })
    }

    if (outcomeRows.length > 0) {
      const { error: outcomeErr } = await client
        .from('outcomes')
        .upsert(outcomeRows, { onConflict: 'order_id', ignoreDuplicates: true })
      if (outcomeErr) {
        // The orders are in; report the outcome problem without hiding it.
        for (const o of outcomeRows) {
          failed.push({ line: lineById.get(o.order_id) ?? 0, reason: outcomeErr.message })
        }
      }
    }

    return { imported, skipped, failed }
  }

  /** Slow path: one row at a time, so a single bad row is attributable. */
  async function importRowByRow(
    chunk: { row: ParsedRow; store: Store }[],
  ): Promise<{ imported: number; skipped: number; failed: Failure[] }> {
    if (!supabase) return { imported: 0, skipped: 0, failed: [] }
    const client = supabase
    const failed: Failure[] = []
    let imported = 0
    let skipped = 0

    for (const { row, store } of chunk) {
      const { error: buyerErr } = await client
        .from('buyers')
        .upsert({ phone: row.phone }, { onConflict: 'phone', ignoreDuplicates: true })
      if (buyerErr) {
        failed.push({ line: row.line, reason: buyerErr.message })
        continue
      }

      const { data, error } = await client
        .from('orders')
        .upsert(orderPayload(row, store), { onConflict: 'store_id,import_ref', ignoreDuplicates: true })
        .select('id')
      if (error) {
        failed.push({ line: row.line, reason: error.message })
        continue
      }
      const created = (data ?? [])[0] as { id: string } | undefined
      if (!created) {
        skipped++
        continue
      }

      if (row.outcome !== 'pending' || row.resolvedAt) {
        const { error: outcomeErr } = await client.from('outcomes').upsert(
          {
            order_id: created.id,
            status: row.outcome,
            resolved_at: row.resolvedAt ?? (row.outcome === 'pending' ? null : new Date().toISOString()),
          },
          { onConflict: 'order_id', ignoreDuplicates: true },
        )
        if (outcomeErr) {
          failed.push({ line: row.line, reason: outcomeErr.message })
          continue
        }
      }
      imported++
    }

    return { imported, skipped, failed }
  }

  function downloadFailures() {
    if (!result || result.failed.length === 0) return
    const blob = new Blob([failedRowsCsv(result.failed)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'verafo-import-failures.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!isConfigured) return <NeedsSetup />

  const hasStoreColumn = parsed.header.includes('store')

  return (
    <PageShell>
      <PageHeader
        title="Bulk Import"
        description="Courier reports are the main import: they set the delivery outcome of every dispatched order. Order history from other platforms is here too — re-importing is safe."
      />

      <Reveal stagger>
        {/* The primary import: courier reports define the outcomes. */}
        <CourierImport stores={stores} />

        <CourierSettings stores={stores} storeId={storeId} />

        <div className="card import-card">
          <div className="import-head">
            <h3 className="card-title">
              <Icon name="document-text-outline" size={16} /> Order history (CSV)
            </h3>
            <button
              className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted md:h-9"
              onClick={() => void copyTemplate()}
            >
              <Icon name="copy-outline" size={15} /> Copy template
            </button>
          </div>
          <pre className="csv-pre">{TEMPLATE_CSV}</pre>
          <p className="import-note">
            Required: <strong>phone</strong>, plus a <strong>store</strong> column or a store picked
            below. Outcomes accept <code>delivered</code>/<code>fulfilled</code>,{' '}
            <code>returned</code>/<code>RTO</code>/<code>cancelled</code>, or blank for pending. Prices
            may include <code>Rs.</code> and thousands separators. Dates may be ISO or{' '}
            <code>DD/MM/YYYY</code> (read as Pakistan time). Columns:{' '}
            {TEMPLATE_COLUMNS.join(', ')}.
          </p>
          <p className="import-note">
            <strong>On Shopify?</strong> Connect the store through the Verafo for Shopify app and
            use <em>Import history</em> there — it reads your orders straight from Shopify and
            feeds the same buyer and risk pipeline, so this CSV is only needed for other
            platforms.
          </p>
        </div>

        {admin && (
          <div className="card import-card">
            <div className="import-head">
              <h3 className="card-title">
                <Icon name="sparkles-outline" size={16} /> AI dummy data generator
              </h3>
              <span className="prompt-hint">
                <Icon name="flash-outline" size={13} /> one click, generated by GPT
              </span>
            </div>
            <p className="import-note">
              Creates new stores with realistic buyers and order histories (products, prices,
              addresses, outcomes). Phones are generated fresh, risk scores are computed
              automatically, and everything lands in the network instantly.
            </p>
            <div className="gen-grid">
              <label className="field">
                <span className="field-label">Stores</span>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={genStores}
                  onChange={(e) => setGenStores(parseInt(e.target.value, 10) || 1)}
                />
              </label>
              <label className="field">
                <span className="field-label">Buyers per store</span>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={genBuyers}
                  onChange={(e) => setGenBuyers(parseInt(e.target.value, 10) || 1)}
                />
              </label>
              <label className="field">
                <span className="field-label">Orders per buyer</span>
                <input
                  type="number"
                  min={2}
                  max={8}
                  value={genOrders}
                  onChange={(e) => setGenOrders(parseInt(e.target.value, 10) || 2)}
                />
              </label>
              <label className="field">
                <span className="field-label">Refusal mix</span>
                <select value={genMix} onChange={(e) => setGenMix(e.target.value as typeof genMix)}>
                  <option value="safe">Mostly safe (~15% refusals)</option>
                  <option value="balanced">Balanced (~35% refusals)</option>
                  <option value="risky">Risky network (~60% refusals)</option>
                </select>
              </label>
            </div>
            <div className="import-actions">
              <button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                disabled={genBusy}
                onClick={() => void generateDummy()}
              >
                {genBusy ? (
                  <>
                    <Icon name="refresh-outline" size={16} className="spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Icon name="sparkles-outline" size={16} /> Generate {genStores} store
                    {genStores === 1 ? '' : 's'} × {genBuyers} buyers
                  </>
                )}
              </button>
            </div>
            {genResult && (
              <div className="import-result">
                <div className="result-banner ok">
                  <Icon name="checkmark-circle" size={16} />
                  Created <strong>{genResult.stores}</strong> store
                  {genResult.stores === 1 ? '' : 's'}, <strong>{genResult.buyers}</strong> buyer
                  {genResult.buyers === 1 ? '' : 's'} and <strong>{genResult.orders}</strong> order
                  {genResult.orders === 1 ? '' : 's'} — {genResult.accepted} accepted,{' '}
                  {genResult.refused} refused, {genResult.pending} pending.
                </div>
                <p className="import-note">
                  Try a Buyer Lookup on any of the new numbers, or mark the pending orders on the
                  Mark Outcome screen.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="card import-card">
          <div className="import-head">
            <h3 className="card-title">
              <Icon name="cloud-upload-outline" size={16} /> Upload or paste
            </h3>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="file-input"
              onChange={onFile}
            />
          </div>

          <div className="gen-grid">
            <label className="field">
              <span className="field-label">
                Import into{hasStoreColumn ? ' (used when a row has no store)' : ''}
              </span>
              <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">
                  {stores.length === 0 ? 'No stores yet' : 'Select a store…'}
                </option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <textarea
            className="import-textarea"
            value={text}
            onChange={(e) => setText(stripBom(e.target.value))}
            placeholder="Paste CSV here — or pick a .csv file above."
            rows={6}
          />

          {(parsed.fileErrors.length > 0 || (text && parsed.rows.length === 0)) && (
            <div className="line-errors">
              {parsed.fileErrors.map((e, i) => (
                <div key={i} className="line-error">
                  <Icon name="alert-circle-outline" size={14} /> {e}
                </div>
              ))}
            </div>
          )}

          {text && parsed.rows.length > 0 && (
            <div className="line-errors">
              {parsed.counts.invalid > 0 && (
                <div className="line-error">
                  <Icon name="alert-circle-outline" size={14} /> {parsed.counts.invalid} row
                  {parsed.counts.invalid === 1 ? '' : 's'} will be skipped — see the preview and the
                  failure list after importing.
                </div>
              )}
              {blockedCount > parsed.counts.invalid && (
                <div className="line-error">
                  <Icon name="alert-circle-outline" size={14} /> {blockedCount - parsed.counts.invalid}{' '}
                  row(s) cannot be matched to a store (unknown or ambiguous name).
                </div>
              )}
              {parsed.unknownOutcomes.length > 0 && (
                <div className="line-error">
                  <Icon name="information-circle" size={14} /> Unrecognised status
                  {parsed.unknownOutcomes.length === 1 ? '' : 'es'} treated as pending:{' '}
                  {parsed.unknownOutcomes.slice(0, 5).join(', ')}
                  {parsed.unknownOutcomes.length > 5 ? '…' : ''}
                </div>
              )}
              {parsed.counts.correctedPrices > 0 && (
                <div className="line-error">
                  <Icon name="information-circle" size={14} /> {parsed.counts.correctedPrices} price
                  value(s) were read through currency symbols or separators.
                </div>
              )}
              {parsed.counts.ambiguousDates > 0 && (
                <div className="line-error">
                  <Icon name="information-circle" size={14} /> {parsed.counts.ambiguousDates} date(s)
                  could be DD/MM or MM/DD — read as DD/MM.
                </div>
              )}
              {parsed.counts.missingDates > 0 && (
                <div className="line-error">
                  <Icon name="information-circle" size={14} /> {parsed.counts.missingDates} row(s)
                  have no order date — they will be timestamped now.
                </div>
              )}
              {duplicateRefs > 0 && (
                <div className="line-error">
                  <Icon name="information-circle" size={14} /> {duplicateRefs} row(s) are duplicates
                  of another row in this file and will be skipped.
                </div>
              )}
            </div>
          )}

          {preview.length > 0 && (
            <div className="preview-wrap">
              <div className="preview-title">First {preview.length} rows</div>
              <table className="preview-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>phone</th>
                    <th>store</th>
                    <th>product</th>
                    <th>price</th>
                    <th>qty</th>
                    <th>city</th>
                    <th>outcome</th>
                    <th>check</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((c) => {
                    const problems = [...c.row.errors]
                    if (c.reason && c.row.errors.length === 0) problems.push(c.reason)
                    return (
                      <tr key={c.row.line} className={problems.length > 0 ? 'row-bad' : ''}>
                        <td>{c.row.line}</td>
                        <td>{c.row.phone || '—'}</td>
                        <td>{c.store?.name ?? (c.row.store || '—')}</td>
                        <td>{c.row.product || '—'}</td>
                        <td>{c.row.price == null ? '—' : money(c.row.price)}</td>
                        <td>{c.row.quantity}</td>
                        <td>{c.row.city || '—'}</td>
                        <td>{c.row.outcome}</td>
                        <td>
                          {problems.length === 0 ? (
                            <span className="bad-mark" style={{ color: 'var(--risk-safe-strong, #067647)' }}>
                              ok
                            </span>
                          ) : (
                            <span className="bad-mark">{problems[0]}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="import-actions">
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              disabled={importing || readyRows.length === 0}
              onClick={() => void runImport()}
            >
              {importing ? (
                <>
                  <Icon name="refresh-outline" size={16} className="spin" /> Importing{' '}
                  {progress.done}/{progress.total}…
                </>
              ) : (
                <>
                  <Icon name="cloud-upload-outline" size={16} /> Import{' '}
                  {readyRows.length > 0 ? `${readyRows.length} rows` : ''}
                </>
              )}
            </button>
            {text && (
              <button
                className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted md:h-9"
                onClick={() => setText('')}
                disabled={importing}
              >
                <Icon name="trash-outline" size={15} /> Clear
              </button>
            )}
          </div>

          {importing && (
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
              />
            </div>
          )}

          {result && (
            <div className="import-result">
              <div className={`result-banner${result.failed.length > 0 ? ' warn' : ' ok'}`}>
                <Icon
                  name={result.failed.length > 0 ? 'alert-circle' : 'checkmark-circle'}
                  size={16}
                />
                Imported <strong>{result.imported}</strong> of <strong>{result.total}</strong> rows.
                {result.skipped > 0 && <> {result.skipped} were already in Verafo and were skipped.</>}
                {result.failed.length === 0 && result.skipped === 0 && ' Scores recomputed automatically.'}
              </div>
              {result.failed.length > 0 && (
                <>
                  <div className="fail-list">
                    {result.failed.slice(0, 100).map((f, i) => (
                      <div key={`${f.line}-${i}`} className="fail-row">
                        <span className="fail-line">line {f.line}</span>
                        <span className="fail-reason">
                          <Icon name="close-circle" size={12} /> {f.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                  {result.failed.length > 100 && (
                    <p className="import-note">Showing the first 100 failures.</p>
                  )}
                  <button
                    className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
                    onClick={downloadFailures}
                  >
                    <Icon name="download-outline" size={15} /> Download failed rows
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </Reveal>
    </PageShell>
  )
}
