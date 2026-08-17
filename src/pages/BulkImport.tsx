import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { Reveal } from '../components/Reveal'
import { NeedsSetup } from '../components/States'
import { normalizePhone } from '../lib/format'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { Store } from '../lib/types'

const TEMPLATE = [
  'phone,store,category,product,price,quantity,address,city,ordered_at,outcome,resolved_at',
  '+923001112222,Sanicore,skincare,Vitamin C serum 30ml,2499,1,House 12 Block B Model Town,Lahore,2026-07-01 14:30,refused,2026-07-03 10:00',
  '+923214445555,Urban Threads,clothing,Cotton t-shirt,1199,2,PECHS Block 2,Karachi,2026-07-05 18:00,accepted,2026-07-06 12:00',
  '+923337778888,Sanicore,skincare,Retinol cream 30ml,2699,1,House 2 F-11 Markaz,Islamabad,2026-07-10 09:15,pending,',
].join('\n')

const HEADER_ALIASES: Record<string, string> = {
  phone: 'phone',
  buyer: 'phone',
  buyer_phone: 'phone',
  mobileno: 'phone',
  number: 'phone',
  store: 'store',
  storename: 'store',
  store_name: 'store',
  category: 'category',
  product_category: 'category',
  product: 'product',
  productname: 'product',
  product_name: 'product',
  item: 'product',
  name: 'product',
  price: 'price',
  amount: 'price',
  value: 'price',
  quantity: 'quantity',
  qty: 'quantity',
  address: 'address',
  city: 'city',
  ordered_at: 'ordered_at',
  date: 'ordered_at',
  orderdate: 'ordered_at',
  order_date: 'ordered_at',
  outcome: 'outcome',
  status: 'outcome',
  result: 'outcome',
  resolved_at: 'resolved_at',
}

type Outcome = 'accepted' | 'refused' | 'pending'

interface ParsedRow {
  line: number
  phone: string
  store: string
  category: string
  product: string
  price: number | null
  quantity: number
  address: string
  city: string
  ordered_at: string | null
  outcome: Outcome | null
  resolved_at: string | null
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      cur = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else {
      cur += c
    }
  }
  row.push(cur)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

function toIso(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  const d = new Date(t.includes(' ') ? t.replace(' ', 'T') : t)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function parseRows(text: string): { rows: ParsedRow[]; header: string[]; lineErrors: string[] } {
  const cells = parseCsv(text)
  if (cells.length === 0) return { rows: [], header: [], lineErrors: ['File is empty'] }
  const header = cells[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const col = new Map<string, number>()
  header.forEach((h, i) => {
    const mapped = HEADER_ALIASES[h]
    if (mapped && !col.has(mapped)) col.set(mapped, i)
  })
  const missing = ['phone', 'store'].filter((k) => !col.has(k))
  if (missing.length > 0) {
    return { rows: [], header, lineErrors: [`Missing required column(s): ${missing.join(', ')}`] }
  }
  const lineErrors: string[] = []
  const rows: ParsedRow[] = []
  for (let i = 1; i < cells.length; i++) {
    const r = cells[i]
    const get = (k: string) => (col.has(k) ? (r[col.get(k)!] ?? '').trim() : '')
    rows.push({
      line: i + 1,
      phone: normalizePhone(get('phone')),
      store: get('store'),
      category: get('category'),
      product: get('product'),
      price: (() => {
        const p = parseFloat(get('price'))
        return Number.isNaN(p) || !get('price') ? null : p
      })(),
      quantity: Math.max(1, parseInt(get('quantity'), 10) || 1),
      address: get('address'),
      city: get('city'),
      ordered_at: toIso(get('ordered_at')),
      outcome: (() => {
        const s = get('outcome').toLowerCase()
        return s === 'accepted' || s === 'refused' || s === 'pending' ? s : null
      })(),
      resolved_at: toIso(get('resolved_at')),
    })
  }
  const badLines = rows.filter((r) => !r.phone || r.phone.length < 6)
  if (badLines.length > 0) {
    lineErrors.push(`Missing or invalid phone on line(s): ${badLines.map((r) => r.line).join(', ')}`)
  }
  return { rows, header, lineErrors }
}

export function BulkImport() {
  const toast = useToast()
  const [stores, setStores] = useState<Store[]>([])
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ imported: number; failed: { line: number; reason: string }[] } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [genStores, setGenStores] = useState(3)
  const [genBuyers, setGenBuyers] = useState(5)
  const [genOrders, setGenOrders] = useState(6)
  const [genMix, setGenMix] = useState<'safe' | 'balanced' | 'risky'>('balanced')
  const [genBusy, setGenBusy] = useState(false)
  const [genResult, setGenResult] = useState<{ stores: number; buyers: number; orders: number; refused: number; pending: number; accepted: number } | null>(null)

  useEffect(() => {
    if (!supabase) return
    supabase
      .from('stores')
      .select('id, name')
      .then(({ data, error }) => {
        if (!error) setStores((data ?? []) as Store[])
      })
  }, [])

  const parsed = useMemo(() => parseRows(text), [text])

  const storeNames = useMemo(
    () => new Set(stores.map((s) => s.name.trim().toLowerCase())),
    [stores],
  )

  const preview = useMemo(() => {
    if (parsed.rows.length === 0) return []
    return parsed.rows.slice(0, 6).map((r) => ({
      ...r,
      storeOk: storeNames.has(r.store.trim().toLowerCase()),
    }))
  }, [parsed.rows, storeNames])

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(f)
    e.target.value = ''
  }

  async function copyTemplate() {
    try {
      await navigator.clipboard.writeText(TEMPLATE)
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
      const json = (await res.json()) as { ok?: boolean; summary?: { stores: number; buyers: number; orders: number; refused: number; pending: number; accepted: number }; error?: string }
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

  async function runImport() {
    if (!supabase) return
    if (parsed.rows.length === 0) {
      toast.push({ kind: 'error', title: 'Nothing to import', detail: parsed.lineErrors.join(' · ') || 'No valid rows.' })
      return
    }
    const storeMap = new Map(stores.map((s) => [s.name.trim().toLowerCase(), s]))
    const total = parsed.rows.length
    setImporting(true)
    setResult(null)
    setProgress(0)
    let imported = 0
    const failed: { line: number; reason: string }[] = []

    for (let i = 0; i < total; i++) {
      const r = parsed.rows[i]
      setProgress(i + 1)
      const store = storeMap.get(r.store.trim().toLowerCase())
      if (!store) {
        failed.push({ line: r.line, reason: `unknown store "${r.store || 'blank'}"` })
        continue
      }
      if (!r.phone) {
        failed.push({ line: r.line, reason: 'missing phone' })
        continue
      }
      try {
        const { error: buyerErr } = await supabase
          .from('buyers')
          .upsert({ phone: r.phone }, { onConflict: 'phone' })
        if (buyerErr) throw buyerErr

        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert({
            buyer_phone: r.phone,
            store_id: store.id,
            product_category: r.category || null,
            product_name: r.product || null,
            price: r.price,
            quantity: r.quantity,
            address: r.address || null,
            city: r.city || null,
            ordered_at: r.ordered_at ?? undefined,
          })
          .select('id')
          .single()
        if (orderErr) throw orderErr

        if (r.outcome && r.outcome !== 'pending') {
          const { error: outErr } = await supabase.from('outcomes').insert({
            order_id: order.id,
            status: r.outcome,
            resolved_at: r.resolved_at,
          })
          if (outErr) throw outErr
        }
        imported++
      } catch (err) {
        failed.push({ line: r.line, reason: err instanceof Error ? err.message : String(err) })
      }
    }

    setImporting(false)
    setResult({ imported, failed })
    toast.push({
      kind: 'success',
      title: `Imported ${imported} of ${total} rows`,
      detail: failed.length > 0 ? `${failed.length} failed — see the list below` : 'Scores recomputed automatically.',
    })
  }

  if (!isConfigured) return <NeedsSetup />

  return (
    <div>
      <PageHeader
        icon="documents-outline"
        title="Bulk Import"
        subtitle="Load many orders (and their outcomes) from a CSV. Risk scores recompute automatically."
      />

      <Reveal stagger>
      <div className="card import-card">
        <div className="import-head">
          <h3 className="card-title">
            <Icon name="document-text-outline" size={16} /> CSV format
          </h3>
          <button className="btn btn-ghost" onClick={() => void copyTemplate()}>
            <Icon name="copy-outline" size={15} /> Copy template
          </button>
        </div>
        <pre className="csv-pre">{TEMPLATE}</pre>
        <p className="import-note">
          <strong>phone</strong> and <strong>store</strong> are required (store must match an
          existing store name). <strong>outcome</strong> can be{' '}
          <code>accepted</code>, <code>refused</code> or left blank (pending). Dates accept{' '}
          <code>YYYY-MM-DD HH:MM</code> or ISO. Other columns are optional.
        </p>
      </div>

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
          <button className="btn btn-primary" disabled={genBusy} onClick={() => void generateDummy()}>
            {genBusy ? (
              <>
                <Icon name="refresh-outline" size={16} className="spin" /> Generating…
              </>
            ) : (
              <>
                <Icon name="sparkles-outline" size={16} /> Generate {genStores} store{genStores === 1 ? '' : 's'} × {genBuyers} buyers
              </>
            )}
          </button>
        </div>
        {genResult && (
          <div className="import-result">
            <div className="result-banner ok">
              <Icon name="checkmark-circle" size={16} />
              Created <strong>{genResult.stores}</strong> store{genResult.stores === 1 ? '' : 's'},{' '}
              <strong>{genResult.buyers}</strong> buyer{genResult.buyers === 1 ? '' : 's'} and{' '}
              <strong>{genResult.orders}</strong> order{genResult.orders === 1 ? '' : 's'} —{' '}
              {genResult.accepted} accepted, {genResult.refused} refused, {genResult.pending} pending.
            </div>
            <p className="import-note">
              Try a Buyer Lookup on any of the new numbers, or mark the pending orders on the
              Mark Outcome screen.
            </p>
          </div>
        )}
      </div>

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

        <textarea
          className="import-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste CSV here — or pick a .csv file above."
          rows={6}
        />

        {parsed.lineErrors.length > 0 && (
          <div className="line-errors">
            {parsed.lineErrors.map((e, i) => (
              <div key={i} className="line-error">
                <Icon name="alert-circle-outline" size={14} /> {e}
              </div>
            ))}
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
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.line} className={!r.storeOk ? 'row-bad' : ''}>
                    <td>{r.line}</td>
                    <td>{r.phone}</td>
                    <td>
                      {r.store}
                      {!r.storeOk && <span className="bad-mark"> unknown</span>}
                    </td>
                    <td>{r.product || '—'}</td>
                    <td>{r.price ?? '—'}</td>
                    <td>{r.quantity}</td>
                    <td>{r.city || '—'}</td>
                    <td>{r.outcome ?? 'pending'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="import-actions">
          <button
            className="btn btn-primary"
            disabled={importing || parsed.rows.length === 0}
            onClick={() => void runImport()}
          >
            {importing ? (
              <>
                <Icon name="refresh-outline" size={16} className="spin" /> Importing {progress}/{parsed.rows.length}…
              </>
            ) : (
              <>
                <Icon name="cloud-upload-outline" size={16} /> Import {parsed.rows.length > 0 ? `${parsed.rows.length} rows` : ''}
              </>
            )}
          </button>
          {text && (
            <button className="btn btn-ghost" onClick={() => setText('')} disabled={importing}>
              <Icon name="trash-outline" size={15} /> Clear
            </button>
          )}
        </div>

        {importing && (
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${(progress / Math.max(1, parsed.rows.length)) * 100}%` }} />
          </div>
        )}

        {result && (
          <div className="import-result">
            <div className="result-banner ok">
              <Icon name="checkmark-circle" size={16} />
              Imported <strong>{result.imported}</strong> of{' '}
              <strong>{result.imported + result.failed.length}</strong> rows.
              {result.failed.length === 0 && ' Scores recomputed automatically.'}
            </div>
            {result.failed.length > 0 && (
              <div className="fail-list">
                {result.failed.map((f) => (
                  <div key={f.line} className="fail-row">
                    <span className="fail-line">line {f.line}</span>
                    <span className="fail-reason">
                      <Icon name="close-circle" size={12} /> {f.reason}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </Reveal>
    </div>
  )
}
