import { useIsAdmin } from '../lib/admin'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  Copy,
  FileText,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Reveal } from '../components/Reveal'
import { NeedsSetup } from '../components/States'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { normalizePhone } from '../lib/format'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
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

const CONTROL =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)] md:h-10 md:text-[15px]'

/** One titled block, so the three steps on this page read as a sequence. */
function Panel({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: typeof FileText
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-[16px] border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
          <Icon className="size-4 shrink-0 text-primary-text" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

export function BulkImport() {
  const toast = useToast()
  const { admin } = useIsAdmin()
  const { role, stores: myStores } = useStoreScope()
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

  const parsed = useMemo(() => parseRows(text), [text])

  const storeNames = useMemo(() => new Set(stores.map((s) => s.name.trim().toLowerCase())), [stores])

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
        // ignoreDuplicates → ON CONFLICT DO NOTHING: we only need the stub row
        // to exist so orders.buyer_phone has something to point at. The real
        // totals/score are written by the recompute trigger, which (unlike a
        // plain UPDATE from here) isn't subject to RLS — see rls-production.sql.
        const { error: buyerErr } = await supabase
          .from('buyers')
          .upsert({ phone: r.phone }, { onConflict: 'phone', ignoreDuplicates: true })
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

  const pctDone = Math.round((progress / Math.max(1, parsed.rows.length)) * 100)

  return (
    <PageShell>
      <PageHeader
        title="Bulk Import"
        description="Load many orders (and their outcomes) from a CSV. Risk scores recompute automatically."
      />

      <Reveal stagger className="flex flex-col gap-6">
        <Panel
          icon={FileText}
          title="CSV format"
          action={
            <Button variant="outline" size="sm" className="h-11 gap-1.5 px-3 md:h-9" onClick={() => void copyTemplate()}>
              <Copy className="size-3.5" /> Copy template
            </Button>
          }
        >
          <pre className="overflow-x-auto rounded-[10px] border border-border bg-muted/40 p-4 font-mono text-[12px] leading-relaxed text-foreground">
            {TEMPLATE}
          </pre>
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            <strong className="font-semibold text-foreground">phone</strong> and{' '}
            <strong className="font-semibold text-foreground">store</strong> are required (store must match an
            existing store name). <strong className="font-semibold text-foreground">outcome</strong> can be{' '}
            <code className="font-mono">accepted</code>, <code className="font-mono">refused</code> or left blank
            (pending). Dates accept <code className="font-mono">YYYY-MM-DD HH:MM</code> or ISO. Other columns are
            optional.
          </p>
        </Panel>

        {admin && (
          <Panel
            icon={Sparkles}
            title="AI dummy data generator"
            action={
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11.5px] text-muted-foreground">
                <Sparkles className="size-3" aria-hidden="true" /> one click, generated by GPT
              </span>
            }
          >
            <p className="text-[12.5px] text-muted-foreground">
              Creates new stores with realistic buyers and order histories (products, prices, addresses, outcomes).
              Phones are generated fresh, risk scores are computed automatically, and everything lands in the network
              instantly.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field id="gen-stores" label="Stores">
                <input
                  id="gen-stores"
                  type="number"
                  min={1}
                  max={5}
                  className={`${CONTROL} font-mono`}
                  value={genStores}
                  onChange={(e) => setGenStores(parseInt(e.target.value, 10) || 1)}
                />
              </Field>
              <Field id="gen-buyers" label="Buyers per store">
                <input
                  id="gen-buyers"
                  type="number"
                  min={1}
                  max={6}
                  className={`${CONTROL} font-mono`}
                  value={genBuyers}
                  onChange={(e) => setGenBuyers(parseInt(e.target.value, 10) || 1)}
                />
              </Field>
              <Field id="gen-orders" label="Orders per buyer">
                <input
                  id="gen-orders"
                  type="number"
                  min={2}
                  max={8}
                  className={`${CONTROL} font-mono`}
                  value={genOrders}
                  onChange={(e) => setGenOrders(parseInt(e.target.value, 10) || 2)}
                />
              </Field>
              <Field id="gen-mix" label="Refusal mix">
                <select
                  id="gen-mix"
                  className={CONTROL}
                  value={genMix}
                  onChange={(e) => setGenMix(e.target.value as typeof genMix)}
                >
                  <option value="safe">Mostly safe (~15% refusals)</option>
                  <option value="balanced">Balanced (~35% refusals)</option>
                  <option value="risky">Risky network (~60% refusals)</option>
                </select>
              </Field>
            </div>
            <div className="mt-4">
              <Button className="h-11 gap-2 px-5" disabled={genBusy} onClick={() => void generateDummy()}>
                {genBusy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" /> Generate {genStores} store{genStores === 1 ? '' : 's'} ×{' '}
                    {genBuyers} buyers
                  </>
                )}
              </Button>
            </div>
            {genResult && (
              <div className="mt-4 flex flex-col gap-2">
                <p className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-risk-safe/40 bg-risk-safe-soft px-3 py-2.5 text-[13px] text-foreground">
                  <CheckCircle2 className="size-4 shrink-0 text-risk-safe-strong" aria-hidden="true" />
                  <span>
                    Created <strong className="font-semibold">{genResult.stores}</strong> store
                    {genResult.stores === 1 ? '' : 's'}, <strong className="font-semibold">{genResult.buyers}</strong>{' '}
                    buyer{genResult.buyers === 1 ? '' : 's'} and{' '}
                    <strong className="font-semibold">{genResult.orders}</strong> order
                    {genResult.orders === 1 ? '' : 's'} — {genResult.accepted} accepted, {genResult.refused} refused,{' '}
                    {genResult.pending} pending.
                  </span>
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  Try a Buyer Lookup on any of the new numbers, or mark the pending orders on the Outcomes screen.
                </p>
              </div>
            )}
          </Panel>
        )}

        <Panel
          icon={CloudUpload}
          title="Upload or paste"
          action={
            <>
              <input
                ref={fileRef}
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={onFile}
              />
              <Button asChild variant="outline" size="sm" className="h-11 gap-1.5 px-3 md:h-9">
                <label htmlFor="csv-file" className="cursor-pointer">
                  <FileText className="size-3.5" /> Choose a .csv
                </label>
              </Button>
            </>
          }
        >
          <label htmlFor="csv-text" className="text-[13px] font-medium text-muted-foreground">
            CSV contents
          </label>
          <textarea
            id="csv-text"
            className="mt-1.5 min-h-32 w-full resize-y rounded-[10px] border border-input bg-card px-3 py-2.5 font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)]"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste CSV here — or pick a .csv file above."
            rows={6}
          />

          {parsed.lineErrors.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5" role="alert">
              {parsed.lineErrors.map((e, i) => (
                <p
                  key={i}
                  className="flex items-start gap-2 rounded-[10px] border border-risk-high/40 bg-risk-high-soft px-3 py-2 text-[12.5px] text-risk-high-strong"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {e}
                </p>
              ))}
            </div>
          )}

          {preview.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[12.5px] text-muted-foreground">First {preview.length} rows</p>
              <div className="overflow-x-auto rounded-[10px] border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>#</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Store</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-end">Price</TableHead>
                      <TableHead className="text-end">Qty</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead className="pe-6">Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((r) => (
                      <TableRow key={r.line} className={cn(!r.storeOk && 'bg-risk-high-soft')}>
                        <TableCell className="font-mono text-[12.5px] tabular-nums">{r.line}</TableCell>
                        <TableCell className="font-mono text-[12.5px]">{r.phone}</TableCell>
                        <TableCell className="text-[12.5px]">
                          {r.store}
                          {!r.storeOk && (
                            <span className="ms-2 font-semibold text-risk-high-strong">unknown</span>
                          )}
                        </TableCell>
                        <TableCell className="text-[12.5px]">{r.product || '—'}</TableCell>
                        <TableCell className="text-end font-mono text-[12.5px] tabular-nums">
                          {r.price ?? '—'}
                        </TableCell>
                        <TableCell className="text-end font-mono text-[12.5px] tabular-nums">{r.quantity}</TableCell>
                        <TableCell className="text-[12.5px]">{r.city || '—'}</TableCell>
                        <TableCell className="pe-6 text-[12.5px]">{r.outcome ?? 'pending'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              className="h-11 gap-2 px-5"
              disabled={importing || parsed.rows.length === 0}
              onClick={() => void runImport()}
            >
              {importing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Importing {progress}/{parsed.rows.length}…
                </>
              ) : (
                <>
                  <CloudUpload className="size-4" /> Import {parsed.rows.length > 0 ? `${parsed.rows.length} rows` : ''}
                </>
              )}
            </Button>
            {text && (
              <Button
                variant="outline"
                className="h-11 gap-1.5 px-4 md:h-9"
                onClick={() => setText('')}
                disabled={importing}
              >
                <Trash2 className="size-3.5" /> Clear
              </Button>
            )}
          </div>

          {importing && (
            <div
              className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pctDone}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Import progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${pctDone}%` }}
              />
            </div>
          )}

          {result && (
            <div className="mt-4 flex flex-col gap-3">
              <p className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-risk-safe/40 bg-risk-safe-soft px-3 py-2.5 text-[13px] text-foreground">
                <CheckCircle2 className="size-4 shrink-0 text-risk-safe-strong" aria-hidden="true" />
                <span>
                  Imported <strong className="font-semibold">{result.imported}</strong> of{' '}
                  <strong className="font-semibold">{result.imported + result.failed.length}</strong> rows.
                  {result.failed.length === 0 && ' Scores recomputed automatically.'}
                </span>
              </p>
              {result.failed.length > 0 && (
                <ul className="m-0 flex max-h-64 list-none flex-col divide-y divide-border overflow-y-auto rounded-[10px] border border-border p-0">
                  {result.failed.map((f) => (
                    <li key={f.line} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[12.5px]">
                      <span className="font-mono text-muted-foreground">line {f.line}</span>
                      <span className="inline-flex items-center gap-1.5 text-risk-high-strong">
                        <AlertCircle className="size-3" aria-hidden="true" /> {f.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>
      </Reveal>
    </PageShell>
  )
}
