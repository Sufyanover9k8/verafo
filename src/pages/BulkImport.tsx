import { useIsAdmin } from '../lib/admin'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { phone } from '../lib/format'
import { resolveBuyerPhone } from '../lib/ui/buyer-key'
import { parseOrderCsv, type ParsedOrder } from '../lib/ui/order-csv'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { AiError, aiJson, classifyAiThrow } from '../lib/ai'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { Store } from '../lib/types'

/**
 * The shape Verafo still accepts. A merchant with a Shopify store never needs
 * this — they upload Shopify's own orders export untouched — but it stays for
 * anyone importing from a spreadsheet of their own, and it is what the parser
 * treats as a Verafo-format file.
 */
const TEMPLATE = [
  'phone,store,category,product,price,quantity,address,city,ordered_at,outcome,resolved_at',
  '+923001112222,Sanicore,skincare,Vitamin C serum 30ml,2499,1,House 12 Block B Model Town,Lahore,2026-07-01 14:30,refused,2026-07-03 10:00',
  '+923214445555,Urban Threads,clothing,Cotton t-shirt,1199,2,PECHS Block 2,Karachi,2026-07-05 18:00,accepted,2026-07-06 12:00',
  '+923337778888,Sanicore,skincare,Retinol cream 30ml,2699,1,House 2 F-11 Markaz,Islamabad,2026-07-10 09:15,pending,',
].join('\n')

/**
 * Shopify's own export header, verbatim. Shown so a merchant can see exactly
 * what is read — and that nothing has to be added to their file.
 */
const SHOPIFY_COLUMNS = [
  'Name',
  'Email',
  'Financial Status',
  'Paid at',
  'Fulfillment Status',
  'Fulfilled at',
  'Accepts Marketing',
  'Currency',
  'Subtotal',
  'Shipping',
  'Taxes',
  'Total',
  'Discount Code',
  'Discount Amount',
  'Shipping Method',
  'Created at',
  'Lineitem quantity',
  'Lineitem name',
  'Lineitem price',
  'Lineitem compare at price',
  'Lineitem sku',
  'Lineitem requires shipping',
  'Lineitem taxable',
  'Lineitem fulfillment status',
  'Billing Name',
  'Billing Street',
  'Billing Address1',
  'Billing Address2',
  'Billing Company',
  'Billing City',
  'Billing Zip',
  'Billing Province',
  'Billing Country',
  'Billing Phone',
  'Shipping Name',
  'Shipping Street',
  'Shipping Address1',
  'Shipping Address2',
  'Shipping Company',
  'Shipping City',
  'Shipping Zip',
  'Shipping Province',
  'Shipping Country',
  'Shipping Phone',
  'Notes',
  'Note Attributes',
  'Cancelled at',
  'Payment Method',
  'Payment Reference',
  'Refunded Amount',
  'Vendor',
  'Outstanding Balance',
  'Employee',
  'Location',
  'Device ID',
  'Id',
  'Tags',
  'Risk Level',
  'Source',
  'Lineitem discount',
  'Tax 1 Name',
  'Tax 1 Value',
  'Tax 2 Name',
  'Tax 2 Value',
  'Tax 3 Name',
  'Tax 3 Value',
  'Tax 4 Name',
  'Tax 4 Value',
  'Tax 5 Name',
  'Tax 5 Value',
  'Phone',
  'Receipt Number',
  'Duties',
  'Billing Province Name',
  'Shipping Province Name',
  'Payment ID',
  'Payment Terms Name',
  'Next Payment Due At',
  'Payment References',
]

/** The columns Verafo actually reads, marked on Shopify's own header. */
const SHOPIFY_TEMPLATE = `${SHOPIFY_COLUMNS.map((c) =>
  [
    'Name',
    'Email',
    'Fulfilled at',
    'Cancelled at',
    'Created at',
    'Lineitem quantity',
    'Lineitem name',
    'Lineitem price',
    'Shipping Address1',
    'Shipping City',
    'Shipping Phone',
    'Billing Phone',
    'Vendor',
  ].includes(c)
    ? `<${c}>`
    : c,
).join(',')}

Columns in <angle brackets> are the ones Verafo reads; the rest of Shopify's export is ignored. Do not add or rename anything — upload the file as Shopify writes it.`

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
  const { role, store: activeStore, stores: myStores } = useStoreScope()
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

  const parsed = useMemo(() => parseOrderCsv(text), [text])

  /**
   * Which store a row belongs to.
   *
   * Shopify's export names the shop as `Vendor`, which need not match a Verafo
   * store name, and a merchant uploading their own export should not have to
   * reconcile the two. So a missing or unmatched store name falls back to the
   * store they are currently working in — which for a merchant is their only
   * store. An admin, who can see every store, still has to be told which one.
   */
  const resolveRow = useCallback(
    (r: ParsedOrder): { storeId: string; storeName: string; fromVendor: string | null } | { error: string } => {
      const byName = stores.find((s) => s.name.trim().toLowerCase() === r.store.trim().toLowerCase())
      if (byName) return { storeId: byName.id, storeName: byName.name, fromVendor: null }
      const fallback = activeStore ?? (stores.length === 1 ? stores[0] : null)
      if (fallback) {
        // A vendor name we do not recognise is worth surfacing, even though the
        // fallback saves the row: it usually means a store is not set up yet.
        const mismatch = r.store && r.store.trim().toLowerCase() !== fallback.name.trim().toLowerCase()
        return { storeId: fallback.id, storeName: fallback.name, fromVendor: mismatch ? r.store : null }
      }
      return {
        error: r.store
          ? `unknown store "${r.store}"`
          : 'no store column — pick a store, or add a store column',
      }
    },
    [stores, activeStore],
  )

  const preview = useMemo(() => {
    if (parsed.orders.length === 0) return []
    return parsed.orders.slice(0, 6).map((r) => {
      const res = resolveRow(r)
      return { ...r, resolved: 'error' in res ? null : res, storeError: 'error' in res ? res.error : null }
    })
  }, [parsed.orders, resolveRow])

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(f)
    e.target.value = ''
  }

  async function copyTemplate(body: string) {
    try {
      await navigator.clipboard.writeText(body)
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
    if (!supabase || !functionsBaseUrl()) return
    setGenBusy(true)
    setGenResult(null)
    try {
      const json = await aiJson<{
        ok?: boolean
        summary?: { stores: number; buyers: number; orders: number; refused: number; pending: number; accepted: number }
      }>('generate-dummy', {
        stores: Math.max(1, Math.min(5, genStores)),
        buyers_per_store: Math.max(1, Math.min(6, genBuyers)),
        orders_per_buyer: Math.max(2, Math.min(8, genOrders)),
        mix: genMix,
      })
      if (!json.ok || !json.summary) throw new AiError({ kind: 'server', title: 'Generation failed' })
      setGenResult(json.summary)
      toast.push({
        kind: 'success',
        title: 'Dummy data generated',
        detail: `${json.summary.stores} stores, ${json.summary.buyers} buyers, ${json.summary.orders} orders. Scores computed automatically.`,
      })
    } catch (err) {
      const failure = classifyAiThrow(err)
      toast.push({ kind: 'error', title: 'Generation failed', detail: failure.detail })
    } finally {
      setGenBusy(false)
    }
  }

  async function runImport() {
    if (!supabase) return
    if (parsed.orders.length === 0) {
      toast.push({
        kind: 'error',
        title: 'Nothing to import',
        detail: parsed.errors.join(' · ') || 'No orders with a phone number were found.',
      })
      return
    }
    const total = parsed.orders.length
    setImporting(true)
    setResult(null)
    setProgress(0)
    let imported = 0
    const failed: { line: number; reason: string }[] = []

    for (let i = 0; i < total; i++) {
      const r = parsed.orders[i]
      setProgress(i + 1)
      const res = resolveRow(r)
      if ('error' in res) {
        failed.push({ line: r.line, reason: res.error })
        continue
      }
      if (!r.phone) {
        failed.push({ line: r.line, reason: 'missing phone' })
        continue
      }
      try {
        /*
         * Join the buyer row already on file when this number exists under a
         * different spelling. Without this an import can fork a second history
         * for the same customer, each with its own risk score.
         */
        const buyerPhone = await resolveBuyerPhone(r.phone)

        // ignoreDuplicates → ON CONFLICT DO NOTHING: we only need the stub row
        // to exist so orders.buyer_phone has something to point at. The real
        // totals/score are written by the recompute trigger, which (unlike a
        // plain UPDATE from here) isn't subject to RLS — see rls-production.sql.
        const { error: buyerErr } = await supabase
          .from('buyers')
          .upsert({ phone: buyerPhone }, { onConflict: 'phone', ignoreDuplicates: true })
        if (buyerErr) throw buyerErr

        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert({
            buyer_phone: buyerPhone,
            store_id: res.storeId,
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
      title: `Imported ${imported} of ${total} order${total === 1 ? '' : 's'}`,
      detail: failed.length > 0 ? `${failed.length} failed — see the list below` : 'Scores recomputed automatically.',
    })
  }

  if (!isConfigured) return <NeedsSetup />

  const pctDone = Math.round((progress / Math.max(1, parsed.orders.length)) * 100)

  return (
    <PageShell>
      <PageHeader
        title="Bulk Import"
        description="Upload your Shopify orders export as it is, or paste a CSV. Risk scores recompute automatically."
      />

      <Reveal stagger className="flex flex-col gap-6">
        <Panel
          icon={FileText}
          title="What to upload"
          action={
            <Button
              variant="outline"
              size="sm"
              className="h-11 gap-1.5 px-3 md:h-9"
              onClick={() => void copyTemplate(SHOPIFY_TEMPLATE)}
            >
              <Copy className="size-3.5" /> Copy template
            </Button>
          }
        >
          <p className="text-[13.5px] text-foreground">
            <strong className="font-semibold">Already on Shopify?</strong> Export your orders — Shopify admin →
            Orders → Export → <em>All orders</em>, CSV for Excel — and upload that file here unchanged. Nothing needs
            editing: the order number, buyer phone, city, address, products, quantities, prices and dates are all read
            from Shopify's own columns.
          </p>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 ps-5 text-[12.5px] text-muted-foreground">
            <li>
              A multi-item order is several rows in Shopify's file; they are merged back into <strong>one order</strong>{' '}
              here, so your order count stays honest.
            </li>
            <li>
              Only the <strong>phone number</strong> is required. Shopify writes it on the customer's row, so any line
              item without one is skipped and reported.
            </li>
            <li>
              The store comes from the export's <strong>Vendor</strong> column when it matches one of your stores, and
              otherwise from the store you are working in.
            </li>
          </ul>
          <details className="mt-4">
            <summary className="cursor-pointer text-[12.5px] font-medium text-primary-text">
              See the exact columns Verafo reads
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-[10px] border border-border bg-muted/40 p-4 font-mono text-[12px] leading-relaxed text-foreground">
              {SHOPIFY_TEMPLATE}
            </pre>
          </details>
          <details className="mt-3">
            <summary className="cursor-pointer text-[12.5px] font-medium text-primary-text">
              No Shopify export? Use Verafo's own template
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-[10px] border border-border bg-muted/40 p-4 font-mono text-[12px] leading-relaxed text-foreground">
              {TEMPLATE}
            </pre>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              <strong className="font-semibold text-foreground">phone</strong> is required;{' '}
              <strong className="font-semibold text-foreground">store</strong> must match an existing store name when it
              is present. <strong className="font-semibold text-foreground">outcome</strong> can be{' '}
              <code className="font-mono">accepted</code>, <code className="font-mono">refused</code> or left blank
              (pending). Dates accept <code className="font-mono">YYYY-MM-DD HH:MM</code> or ISO.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-11 gap-1.5 px-3 md:h-9"
              onClick={() => void copyTemplate(TEMPLATE)}
            >
              <Copy className="size-3.5" /> Copy this template
            </Button>
          </details>
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

          {/* What the parser made of the file, in the file's own terms. */}
          {parsed.format && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-risk-safe/40 bg-risk-safe-soft px-2.5 py-0.5 font-medium text-risk-safe-strong">
                {parsed.format === 'shopify' ? 'Shopify export' : 'Verafo template'}
              </span>
              <span>
                <strong className="font-semibold text-foreground">{parsed.orders.length}</strong> order
                {parsed.orders.length === 1 ? '' : 's'} found
              </span>
              {parsed.skipped > 0 && (
                <span>
                  · {parsed.skipped} row{parsed.skipped === 1 ? '' : 's'} skipped (no phone number)
                </span>
              )}
            </p>
          )}

          {parsed.errors.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5" role="alert">
              {parsed.errors.map((e, i) => (
                <p
                  key={i}
                  className="flex items-start gap-2 rounded-[10px] border border-risk-high/50 bg-risk-high-badge-bg px-3 py-2 text-[12.5px] text-risk-high-badge"
                >
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /> {e}
                </p>
              ))}
            </div>
          )}

          {preview.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[12.5px] text-muted-foreground">
                First {preview.length} order{preview.length === 1 ? '' : 's'} — this is what will be imported
              </p>
              <div className="overflow-x-auto rounded-[10px] border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Order</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Store</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead className="text-end">Amount</TableHead>
                      <TableHead className="text-end">Items</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead className="pe-6">Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((r) => (
                      <TableRow key={`${r.line}-${r.reference}`} className={cn(r.storeError && 'bg-risk-high-badge-bg')}>
                        <TableCell className="font-mono text-[12.5px]">{r.reference || `line ${r.line}`}</TableCell>
                        <TableCell className="font-mono text-[12.5px]">{phone(r.phone)}</TableCell>
                        <TableCell className="text-[12.5px]">
                          {r.resolved ? (
                            <>
                              {r.resolved.storeName}
                              {r.resolved.fromVendor && (
                                <span className="ms-2 text-muted-foreground">
                                  (export said “{r.resolved.fromVendor}”)
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="font-semibold text-risk-high-badge">{r.storeError}</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-72 truncate text-[12.5px]">{r.product || '—'}</TableCell>
                        <TableCell className="text-end font-mono text-[12.5px] tabular-nums">
                          {r.price == null ? '—' : r.price.toLocaleString('en-PK')}
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
              disabled={importing || parsed.orders.length === 0}
              onClick={() => void runImport()}
            >
              {importing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Importing {progress}/{parsed.orders.length}…
                </>
              ) : (
                <>
                  <CloudUpload className="size-4" /> Import{' '}
                  {parsed.orders.length > 0
                    ? `${parsed.orders.length} order${parsed.orders.length === 1 ? '' : 's'}`
                    : ''}
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
