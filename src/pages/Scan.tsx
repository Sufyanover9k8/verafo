import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Search, X } from 'lucide-react'
import { PageHeader } from '@/components/app/page-header'
import { PageShell } from '@/components/app/page-shell'
import { CardState } from '@/components/app/card-state'
import { EmptyHint } from '@/components/app/empty-hint'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { isConfigured, supabase } from '@/lib/supabase'
import { useToast } from '@/lib/toast'
import { useStoreScope } from '@/lib/store'
import { formatPKR } from '@/lib/ui'
import {
  dedupeScanned,
  planBatches,
  progressOf,
  scanCaveats,
  scanHeadline,
  summariseScan,
  type ScanInput,
  type ScanSummary,
} from '@/lib/ui/scan'
import { NeedsSetup } from '@/components/States'

/** Rows fetched per request. Kept modest so a big store stays responsive. */
const BATCH_SIZE = 200
/** Hard stop, so one click can never try to walk an entire order history. */
const MAX_BATCHES = 25

interface RawOrder {
  id: string
  buyer_phone: string | null
  city: string | null
  product_name: string | null
  product_category: string | null
  price: number | null
  quantity: number | null
  ordered_at: string | null
  outcomes?: { status: string | null } | null
  buyers?: { risk_score: number | null; total_orders: number | null } | null
}

export function Scan() {
  const toast = useToast()
  const { store, scopeStoreIds } = useStoreScope()

  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [planned, setPlanned] = useState(0)
  const [summary, setSummary] = useState<ScanSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Stops the loop between batches when the merchant cancels. */
  const cancelled = useRef(false)
  /** Ids counted in this run, so a retried batch never double-counts. */
  const seen = useRef<Set<string>>(new Set())
  /** Everything gathered, for the summary and the caveats. */
  const collected = useRef<ScanInput[]>([])
  const missingPhone = useRef(0)

  const run = useCallback(
    async (offset: number) => {
      if (!supabase) return
      cancelled.current = false
      setRunning(true)
      setError(null)
      setSummary(null)
      setDone(0)

      const batches = planBatches(BATCH_SIZE * MAX_BATCHES, BATCH_SIZE)
      setPlanned(batches.length)

      try {
        for (let i = 0; i < batches.length; i++) {
          if (cancelled.current) {
            toast.push({ kind: 'success', title: 'Scan stopped', detail: 'What was scanned so far was kept.' })
            break
          }

          const b = batches[i]
          let q = supabase
            .from('orders')
            .select(
              'id, buyer_phone, city, product_name, product_category, price, quantity, ordered_at, outcomes(status), buyers(risk_score, total_orders)',
            )
            .order('ordered_at', { ascending: false })
            .range(offset + b.from, offset + b.to - 1)
          if (store) q = q.eq('store_id', store.id)
          else if (scopeStoreIds) q = q.in('store_id', scopeStoreIds)

          const { data, error: qErr } = await q
          if (qErr) {
            // A failed batch does not lose earlier work; the merchant can retry.
            setError(`Stopped at batch ${i + 1}: ${qErr.message}`)
            break
          }

          const rows = (data ?? []) as unknown as RawOrder[]
          if (rows.length === 0) break // end of the history

          const usable: ScanInput[] = []
          for (const r of rows) {
            if (!r.buyer_phone) {
              missingPhone.current++
              continue
            }
            const raw = r.outcomes?.status
            usable.push({
              id: r.id,
              buyer_phone: r.buyer_phone,
              city: r.city,
              product_name: r.product_name,
              product_category: r.product_category,
              price: r.price,
              quantity: r.quantity,
              ordered_at: r.ordered_at,
              outcome: raw === 'accepted' || raw === 'refused' ? raw : 'pending',
              riskScore: r.buyers?.risk_score ?? null,
              buyerOrders: r.buyers?.total_orders ?? null,
            })
          }

          // Duplicate prevention across retries and overlapping pages.
          const fresh = dedupeScanned(usable, seen.current)
          for (const f of fresh) seen.current.add(String(f.id))

          collected.current.push(...fresh)
          setDone(collected.current.length)

          if (rows.length < BATCH_SIZE) break // last page
        }

        const s = summariseScan(collected.current, undefined, missingPhone.current)
        setSummary(s)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setRunning(false)
      }
    },
    [store, scopeStoreIds, toast],
  )

  /** Start a fresh scan. Resets the de-duplication set. */
  function startFresh() {
    seen.current = new Set()
    collected.current = []
    missingPhone.current = 0
    void run(0)
  }

  const progress = progressOf(done, planned * BATCH_SIZE)

  const caveats = useMemo(() => (summary ? scanCaveats(summary) : []), [summary])

  if (!isConfigured) return <NeedsSetup />

  return (
    <PageShell>
      <PageHeader
        title="Historical scan"
        description="Look back over orders you already have, to see what the risk picture looks like now."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button
                variant="outline"
                size="sm"
                className="h-11 md:h-9"
                onClick={() => {
                  cancelled.current = true
                }}
              >
                <X className="size-4" /> Stop
              </Button>
            ) : (
              <Button size="sm" className="h-11 md:h-9" onClick={startFresh}>
                <Search className="size-4" /> Start scan
              </Button>
            )}
          </div>
        }
      />

      {/* What this is, before anything runs. */}
      <Card className="gap-0 border-risk-watch/40 bg-risk-watch-soft p-5">
        <p className="flex items-start gap-2 text-[13.5px] text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">This is a look back, not a prediction.</strong> Verafo works the
            scores out from today’s buyer history. These are not the scores that existed when the orders were
            placed, and Verafo did not prevent any of them.
          </span>
        </p>
      </Card>

      {running && (
        <Card className="gap-0 p-5">
          <p className="text-[13.5px] font-semibold text-foreground">
            Scanning… {done.toLocaleString('en-PK')} orders read
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${Math.max(2, progress * 100)}%` }} />
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Working in batches of {BATCH_SIZE}. You can keep using the rest of Verafo while this runs.
          </p>
        </Card>
      )}

      <CardState loading={false} error={error} onRetry={() => void run(0)}>
        {!summary ? (
          <Card className="gap-0 p-6">
            <EmptyHint
              large
              title="Nothing scanned yet"
              detail="Start a scan to see how many of your past orders come from buyers who look risky today, and what is still undecided."
            />
          </Card>
        ) : summary.scanned === 0 ? (
          <Card className="gap-0 p-6">
            <EmptyHint
              large
              title="No orders to scan"
              detail="Once this store has orders, run the scan again."
            />
          </Card>
        ) : (
          <>
            <Card className="gap-0 p-6">
              <h2 className="text-[15px] font-semibold text-foreground">What the scan found</h2>
              <p className="mt-2 text-[14px] text-foreground">{scanHeadline(summary)}</p>

              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                {[
                  ['Orders scanned', summary.scanned.toLocaleString('en-PK')],
                  ['HIGH RISK today', summary.highRisk.toLocaleString('en-PK')],
                  ['MEDIUM RISK today', summary.mediumRisk.toLocaleString('en-PK')],
                  ['No score possible', summary.unscored.toLocaleString('en-PK')],
                  ['Refused at the door', summary.refused.toLocaleString('en-PK')],
                  ['Still no outcome', summary.unknownOutcome.toLocaleString('en-PK')],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-[11.5px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                      {label}
                    </dt>
                    <dd className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-foreground">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-3">
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Refusal rate</dt>
                  <dd className="mt-0.5 text-[15px] font-semibold text-foreground">
                    {summary.refusalRate == null
                      ? 'Not published'
                      : `${Math.round(summary.refusalRate * 100)}% of ${summary.accepted + summary.refused} resolved`}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Value of refused orders</dt>
                  <dd className="mt-0.5 text-[15px] font-semibold text-foreground">
                    {summary.refusedValue == null ? 'No prices recorded' : formatPKR(summary.refusedValue)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12.5px] text-muted-foreground">Value still undecided</dt>
                  <dd className="mt-0.5 text-[15px] font-semibold text-foreground">
                    {summary.valueAtRisk == null ? 'No prices recorded' : formatPKR(summary.valueAtRisk)}
                  </dd>
                </div>
              </dl>

              <Button asChild variant="outline" size="sm" className="mt-5 h-11 md:h-9">
                <Link to="/orders">Inspect the orders</Link>
              </Button>
            </Card>

            {/* The limits, shown with the result rather than hidden. */}
            <Card className="gap-0 p-5">
              <h3 className="text-[13.5px] font-semibold text-foreground">What this does not tell you</h3>
              <ul className="mt-2 flex list-none flex-col gap-1.5 p-0">
                {caveats.map((c) => (
                  <li key={c} className="text-[12.5px] text-muted-foreground">
                    {c}
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </CardState>
    </PageShell>
  )
}
