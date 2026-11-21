import { useEffect, useMemo, useRef, useState } from 'react'
import { useIsAdmin } from '../../lib/admin'
import { Icon } from '../Icon'
import { money } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useStoreScope } from '../../lib/store'
import { useToast } from '../../lib/toast'
import type { Store } from '../../lib/types'
import {
  failedRowsCsv,
  parseImport,
  stripBom,
  TEMPLATE_COLUMNS,
  TEMPLATE_CSV,
  type ParsedRow,
} from '../../lib/ui/import'

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

/**
 * Orders that already reached Verafo from Shopify. The CSV importer keys on
 * `import_ref` and the Shopify sync keys on `shopify_order_id`, so the same
 * physical order could otherwise land twice. This is the fallback key both
 * sides can produce: store + phone + order day.
 */
interface SyncedOrder {
  store_id: string
  buyer_phone: string | null
  ordered_at: string | null
}

const digits = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '').slice(-10)

/** Pakistan has no DST, so a fixed offset is exact and keeps both sides aligned. */
const PK_OFFSET_MS = 5 * 60 * 60 * 1000

/** The calendar day an order was placed, in Pakistan time. */
const dayKey = (iso: string | null | undefined) => {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return iso.slice(0, 10)
  return new Date(t + PK_OFFSET_MS).toISOString().slice(0, 10)
}

const syncKey = (storeId: string, phone: string | null | undefined, orderedAt: string | null | undefined) =>
  `${storeId}|${digits(phone)}|${dayKey(orderedAt)}`

export function OrderImport() {
  const toast = useToast()
  const { admin } = useIsAdmin()
  const { role, stores: myStores } = useStoreScope()

  const [stores, setStores] = useState<Store[]>([])
  const [synced, setSynced] = useState<SyncedOrder[]>([])
  const [text, setText] = useState('')
  const [storeId, setStoreId] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!supabase) return
    // Merchants can only import into their own store(s).
    if (role !== 'admin') {
      setStores(myStores.map((s) => ({ id: s.id, name: s.name })) as Store[])
      return
    }
    supabase
      .from('stores')
      .select('id, name, shopify_domain')
      .then(({ data, error }) => {
        if (!error) setStores((data ?? []) as Store[])
      })
  }, [role, myStores])

  // Which of these stores already pull orders from Shopify.
  useEffect(() => {
    if (!supabase || stores.length === 0) return
    supabase
      .from('stores')
      .select('id, shopify_domain')
      .in(
        'id',
        stores.map((s) => s.id),
      )
      .then(({ data }) => {
        const domains = new Map(
          ((data ?? []) as { id: string; shopify_domain: string | null }[]).map((s) => [
            s.id,
            s.shopify_domain,
          ]),
        )
        setStores((prev) =>
          prev.map((s) =>
            domains.has(s.id) ? { ...s, shopify_domain: domains.get(s.id) ?? null } : s,
          ),
        )
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores.length])

  // A cheap fingerprint of every Shopify-synced order, so a CSV row for the
  // same order is skipped instead of duplicated.
  useEffect(() => {
    if (!supabase) return
    supabase
      .from('orders')
      .select('store_id, buyer_phone, ordered_at')
      .not('shopify_order_id', 'is', null)
      .limit(50000)
      .then(({ data, error }) => {
        if (!error) setSynced((data ?? []) as SyncedOrder[])
      })
  }, [])

  const syncedKeys = useMemo(
    () => new Set(synced.map((o) => syncKey(o.store_id, o.buyer_phone, o.ordered_at))),
    [synced],
  )

  const shopifyStores = useMemo(() => stores.filter((s) => s.shopify_domain), [stores])

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
    () =>
      parsed.rows.map((r) => {
        const resolved = resolveStore(r)
        if (!resolved.store || r.errors.length > 0) return { row: r, ...resolved }
        // Already here via Shopify — say so up front instead of failing later.
        if (syncedKeys.has(syncKey(resolved.store.id, r.phone, r.orderedAt))) {
          return { row: r, ...resolved, reason: 'already synced from Shopify' }
        }
        return { row: r, ...resolved }
      }),
    [parsed.rows, resolveStore, syncedKeys],
  )

  const readyRows = useMemo(
    () => rowChecks.filter((r) => r.row.errors.length === 0 && r.store !== null && !r.reason),
    [rowChecks],
  )

  const syncedCount = useMemo(() => rowChecks.filter((r) => r.reason === 'already synced from Shopify').length, [rowChecks])

  const blockedCount = rowChecks.length - readyRows.length

  const duplicateRefs = useMemo(() => {
    const seen = new Set<string>()
    let dupes = 0
    for (const c of readyRows) {
      const key = `${c.store?.id}:${c.row.importRef}`
      if (seen.has(key)) dupes++
      else seen.add(key)
    }
    return dupes
  }, [readyRows])

  const hasStoreColumn = useMemo(
    () => parsed.rows.some((r) => r.store.trim().length > 0),
    [parsed.rows],
  )

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

  if (admin === undefined) return null

  return (
    <div className="order-import">
      {shopifyStores.length > 0 && (
        <div className="import-callout">
          <Icon name="information-circle" size={16} />
          <div>
            <strong>{shopifyStores.map((s) => s.name).join(', ')}</strong>{' '}
            {shopifyStores.length === 1 ? 'is' : 'are'} connected to Shopify, so orders sync on their
            own. Rows that match an order already synced are skipped.
          </div>
        </div>
      )}

      <div className="import-head">
        <span className="field-label">Upload or paste a CSV</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="file-input"
          onChange={onFile}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="cloud-upload-outline" size={15} /> Choose file
        </button>
      </div>

      <div className="gen-grid">
        <label className="field">
          <span className="field-label">
            Import into{hasStoreColumn ? ' (used when a row has no store)' : ''}
          </span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">{stores.length === 0 ? 'No stores yet' : 'Select a store…'}</option>
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

      {((text.trim() && parsed.fileErrors.length > 0) || (text.trim() && parsed.rows.length === 0)) && (
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
          {syncedCount > 0 && (
            <div className="line-error">
              <Icon name="checkmark-circle" size={14} /> {syncedCount} row
              {syncedCount === 1 ? ' is' : 's are'} already in Verafo from Shopify and will be
              skipped.
            </div>
          )}
          {blockedCount > parsed.counts.invalid + syncedCount && (
            <div className="line-error">
              <Icon name="alert-circle-outline" size={14} />{' '}
              {blockedCount - parsed.counts.invalid - syncedCount} row(s) cannot be matched to a store
              (unknown or ambiguous name).
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
              <Icon name="information-circle" size={14} /> {parsed.counts.missingDates} row(s) have
              no order date — they will be timestamped now.
            </div>
          )}
          {duplicateRefs > 0 && (
            <div className="line-error">
              <Icon name="information-circle" size={14} /> {duplicateRefs} row(s) are duplicates of
              another row in this file and will be skipped.
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
        <button className="btn btn-primary btn-sm" disabled={importing || readyRows.length === 0} onClick={() => void runImport()}>
          {importing ? (
            <>
              <Icon name="refresh-outline" size={16} className="spin" /> Importing {progress.done}/
              {progress.total}…
            </>
          ) : (
            <>
              <Icon name="cloud-upload-outline" size={16} /> Import{' '}
              {readyRows.length > 0
                ? `${readyRows.length} row${readyRows.length === 1 ? '' : 's'}`
                : ''}
            </>
          )}
        </button>
        {text && (
          <button className="btn btn-ghost btn-sm" onClick={() => setText('')} disabled={importing}>
            <Icon name="trash-outline" size={15} /> Clear
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyTemplate()}>
          <Icon name="copy-outline" size={15} /> Copy template
        </button>
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
            <Icon name={result.failed.length > 0 ? 'alert-circle' : 'checkmark-circle'} size={16} />
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
              <button className="btn btn-ghost btn-sm" onClick={downloadFailures}>
                <Icon name="download-outline" size={15} /> Download failed rows
              </button>
            </>
          )}
        </div>
      )}

      <details className="csv-details">
        <summary>
          <Icon name="chevron-down" size={14} /> What the file needs to look like
        </summary>
        <p className="import-note">
          One row per order. Columns: <code>{TEMPLATE_COLUMNS.join(', ')}</code>. Columns can be in
          any order, and extra columns are ignored.
        </p>
        <pre className="csv-pre">{TEMPLATE_CSV}</pre>
      </details>
    </div>
  )
}