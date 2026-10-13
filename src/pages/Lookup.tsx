import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { VerdictBadge } from '../components/app/verdict-badge'
import { StatusBadge } from '../components/app/status-badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '../components/primitives/Skeleton'
import { Avatar } from '../components/Avatar'
import { Reveal } from '../components/Reveal'
import { EmptyState, NeedsSetup } from '../components/States'
import { dateTime, money, normalizePhone, phone, timeAgo } from '../lib/format'
import { computeVerdict, riskFactors, type VerdictTone } from '../lib/risk'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { Buyer, OrderRow, SimilarBuyer } from '../lib/types'

/** What buyer_network_lookup returns. Aggregates only — no identity. */
interface NetworkLookupRow {
  risk_score: number | null
  total_orders: number | null
  total_accepted: number | null
  total_refused: number | null
  store_count: number | null
  first_seen: string | null
}

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'found'; buyer: Buyer; orders: OrderRow[]; similar: SimilarBuyer[] }

interface LookupRow {
  id: string
  buyer_phone: string
  searched_at: string | null
  buyers?: { risk_score: number; total_orders: number } | null
}

/** The verdict word's colour and dot, as tokens. The word is always shown. */
const VERDICT_TEXT: Record<VerdictTone, string> = {
  safe: 'text-risk-safe-strong',
  watch: 'text-risk-watch-strong',
  high: 'text-risk-high-strong',
  unknown: 'text-risk-unknown-strong',
}
const VERDICT_DOT: Record<VerdictTone, string> = {
  safe: 'bg-risk-safe',
  watch: 'bg-risk-watch',
  high: 'bg-risk-high',
  unknown: 'bg-risk-unknown',
}

const inputClass =
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 text-[16px] text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)] md:h-10 md:text-[15px]'

const buttonClass =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50'

export function Lookup() {
  const toast = useToast()
  const { store } = useStoreScope()
  const { email } = useSession()
  const [params, setParams] = useSearchParams()
  const [input, setInput] = useState(params.get('phone') ?? '')
  const [searched, setSearched] = useState('')
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  const [recents, setRecents] = useState<LookupRow[]>([])
  const [explaining, setExplaining] = useState(false)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [embeddingBusy, setEmbeddingBusy] = useState(false)

  // "Recent lookups" is a personal history, not shared with other merchants —
  // scoped by owner_email both here and in RLS (see rls-production.sql).
  const loadRecents = useCallback(async () => {
    if (!supabase || !email) return
    const { data, error } = await supabase
      .from('lookups')
      .select('id, buyer_phone, searched_at, buyers(risk_score, total_orders)')
      .eq('owner_email', email)
      .order('searched_at', { ascending: false })
      .limit(8)
    if (!error) setRecents((data ?? []) as unknown as LookupRow[])
  }, [email])

  useEffect(() => {
    void loadRecents()
  }, [loadRecents])

  const search = useCallback(
    async (p: string) => {
      if (!supabase) return
      const normalized = normalizePhone(p)
      if (normalized.length < 6) return
      setSearched(normalized)
      setExplanation(null)
      setState({ kind: 'loading' })

      // PRIVACY: this used to run `from('buyers').select('*')`, which pulled
      // the raw embedding and feature vector into the browser, and it called
      // find_similar_buyers() — a plain SQL function that returned other
      // buyers' phone numbers. Both are gone.
      //
      // buyer_network_lookup returns an aggregate risk assessment only: no
      // identity, no store identity, no order detail, no vector. The merchant
      // still gets the answer for any number they already know.
      let ordersQuery = supabase.from('orders').select('*, stores(name), outcomes(status, resolved_at, refusal_reason)').eq('buyer_phone', normalized)
      if (store) ordersQuery = ordersQuery.eq('store_id', store.id)

      const [lookupRes, ordersRes] = await Promise.all([
        supabase.rpc('buyer_network_lookup', { p_phone: normalized }),
        ordersQuery.order('ordered_at', { ascending: false }),
      ])

      if (lookupRes.error) {
        toast.push({ kind: 'error', title: 'Lookup failed', detail: lookupRes.error.message })
        setState({ kind: 'idle' })
        return
      }

      const network = ((lookupRes.data ?? []) as NetworkLookupRow[])[0]
      if (!network) {
        setState({ kind: 'not-found' })
        return
      }

      const buyer: Buyer = {
        phone: normalized,
        first_seen: network.first_seen ?? null,
        total_orders: network.total_orders ?? 0,
        total_accepted: network.total_accepted ?? 0,
        total_refused: network.total_refused ?? 0,
        risk_score: Number(network.risk_score ?? 0.5),
        store_count: network.store_count ?? 0,
        // No embedding is requested or received, so the AI actions stay hidden.
        embedding: null,
      }
      const orders = (ordersRes.data ?? []) as unknown as OrderRow[]

      // Similarity by phone: the server keeps the vector, and the result
      // carries no phone number, so it cannot become a contact list.
      let similar: SimilarBuyer[] = []
      const simRes = await supabase.rpc('similar_buyers_by_phone', {
        p_phone: normalized,
        p_limit: 5,
      })
      if (!simRes.error) similar = (simRes.data ?? []) as SimilarBuyer[]

      if (email) {
        await supabase.from('lookups').insert({ buyer_phone: normalized, owner_email: email })
        void loadRecents()
      }

      setState({ kind: 'found', buyer, orders, similar })
    },
    [store, email, loadRecents, toast],
  )

  // A phone in the URL runs the search on arrival (the header quick-check links here).
  useEffect(() => {
    const p = params.get('phone')
    if (!p) return
    setInput(p)
    void search(p)
    setParams({}, { replace: true })
  }, [params, search, setParams])

  const handleSearch = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      void search(input)
    },
    [input, search],
  )

  const openRecent = useCallback(
    (p: string) => {
      setInput(p)
      void search(p)
    },
    [search],
  )

  const clearAll = useCallback(async () => {
    if (!supabase || !email) return
    const { error } = await supabase.from('lookups').delete().eq('owner_email', email)
    if (error) {
      toast.push({ kind: 'error', title: 'Could not clear history', detail: error.message })
      return
    }
    setRecents([])
    toast.push({ kind: 'success', title: 'History cleared' })
  }, [email, toast])

  async function explain(buyer: Buyer) {
    if (!supabase) return
    setExplaining(true)
    try {
      const base = functionsBaseUrl()
      if (!base) throw new Error('Edge functions are not deployed.')
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode: 'explain', buyer }),
      })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const json = (await res.json()) as { text?: string }
      setExplanation(json.text ?? null)
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not explain this buyer',
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setExplaining(false)
    }
  }

  async function refreshEmbedding(buyer: Buyer) {
    if (!supabase) return
    setEmbeddingBusy(true)
    try {
      const base = functionsBaseUrl()
      if (!base) throw new Error('Edge functions are not deployed.')
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode: 'embed', phone: buyer.phone }),
      })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      toast.push({ kind: 'success', title: 'Fingerprint refreshed' })
      void search(buyer.phone)
    } catch (err) {
      toast.push({
        kind: 'error',
        title: 'Could not refresh the fingerprint',
        detail: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setEmbeddingBusy(false)
    }
  }

  if (!isConfigured) return <NeedsSetup />

  const buyer = state.kind === 'found' ? state.buyer : null
  const orders = state.kind === 'found' ? state.orders : []
  const aiEnabled = Boolean(functionsBaseUrl())

  const verdict = buyer
    ? computeVerdict({
        risk_score: buyer.risk_score,
        total_orders: buyer.total_orders,
        total_accepted: buyer.total_accepted,
        total_refused: buyer.total_refused,
      })
    : null

  return (
    <PageShell>
      <PageHeader
        title="Buyer Lookup"
        description="Type any phone number to see its full cross-store profile and risk score."
      />

      {/* One clear search box. */}
      <form className="rounded-[16px] border border-border bg-card p-6" onSubmit={handleSearch}>
        <label className="flex flex-col gap-2">
          <span className="text-[15px] font-semibold text-foreground">Enter a buyer&rsquo;s phone number</span>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className={inputClass}
              type="tel"
              inputMode="tel"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0301 234 5678"
              aria-label="Buyer phone number"
            />
            <button type="submit" className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
              <Icon name="arrow-forward" size={16} /> Look up
            </button>
          </div>
          <span className="text-[13px] text-muted-foreground">
            Search the network-wide profile: totals, stores, timeline and risk score.
          </span>
        </label>
      </form>

      {/* Before the first search. */}
      {state.kind === 'idle' && recents.length > 0 && (
        <Card className="gap-0 p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-semibold text-foreground">Recent lookups</h3>
            <button type="button" className={buttonClass} onClick={() => void clearAll()}>
              <Icon name="trash" size={15} /> Clear
            </button>
          </div>
          <Reveal stagger className="flex flex-col gap-1">
            {recents.map((r) => (
              <button
                key={r.id}
                type="button"
                className="flex min-h-11 items-center gap-3 rounded-[10px] px-2 py-2.5 text-start transition-colors hover:bg-muted"
                onClick={() => openRecent(r.buyer_phone)}
              >
                <Avatar phone={r.buyer_phone} size={26} />
                <span className="flex-1 font-mono text-[13px] font-medium">{phone(r.buyer_phone)}</span>
                <VerdictBadge riskScore={r.buyers?.risk_score} totalOrders={r.buyers?.total_orders} />
                <span className="hidden text-[13px] text-muted-foreground sm:inline">{timeAgo(r.searched_at)}</span>
              </button>
            ))}
          </Reveal>
        </Card>
      )}

      {state.kind === 'idle' && recents.length === 0 && (
        <Card className="gap-0 p-6">
          <EmptyState
            icon="fingerprint"
            title="Enter a phone number"
            detail="Search the network-wide profile: totals, stores, timeline and risk score."
          />
        </Card>
      )}

      {state.kind === 'loading' && (
        <Card className="gap-3 p-6">
          <Skeleton width="40%" height={18} />
          <Skeleton width="65%" height={12} />
          <Skeleton width="50%" height={12} />
          <Skeleton width="30%" height={12} />
        </Card>
      )}

      {state.kind === 'not-found' && (
        <Card className="gap-0 p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <p className="text-[15px] font-semibold text-foreground">No buyer found</p>
            <p className="max-w-md text-[15px] text-muted-foreground">
              {phone(searched)} has no profile yet. Their first order creates one.
            </p>
            <button type="button" className={buttonClass} onClick={() => setState({ kind: 'idle' })}>
              Try another number
            </button>
          </div>
        </Card>
      )}

      {buyer && verdict && (
        <Reveal stagger className="grid gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-7">
            {/* Verdict first. */}
            <Card className="gap-4 p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`size-3 rounded-full ${VERDICT_DOT[verdict.tone]}`} aria-hidden="true" />
                <h2 className={`text-3xl font-bold tracking-tight ${VERDICT_TEXT[verdict.tone]}`}>{verdict.label}</h2>
                <span className="ms-auto font-mono text-[15px] text-muted-foreground">
                  {phone(buyer.phone)} · {verdict.confidenceLabel}
                </span>
              </div>

              <ul className="flex flex-col gap-2 text-[15px] text-foreground">
                <li>
                  <strong className="font-semibold tabular-nums">{buyer.total_orders ?? 0}</strong> order
                  {(buyer.total_orders ?? 0) === 1 ? '' : 's'} in the network
                </li>
                <li>
                  <strong className="font-semibold tabular-nums">{buyer.total_accepted ?? 0}</strong> accepted ·{' '}
                  <strong className="font-semibold tabular-nums">{buyer.total_refused ?? 0}</strong> refused
                </li>
                <li>
                  <strong className="font-semibold tabular-nums">{new Set(orders.map((o) => o.store_id)).size}</strong> connected
                  store{new Set(orders.map((o) => o.store_id)).size === 1 ? '' : 's'}
                </li>
                <li className="text-muted-foreground">
                  First seen {buyer.first_seen ? dateTime(buyer.first_seen) : 'unknown'}
                </li>
              </ul>
            </Card>

            {/* The reasons, in plain lines. */}
            <Card className="gap-0 p-6">
              <h3 className="mb-3 text-[15px] font-semibold text-foreground">Main reasons</h3>
              <ul className="flex flex-col divide-y divide-border">
                {riskFactors({ ...buyer, orders }).map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-3 text-[15px]">
                    <span className="text-foreground">{f.label}</span>
                    <span
                      className={`shrink-0 font-mono text-[13px] ${
                        f.impact === 'neg' ? 'text-risk-high-strong' : f.impact === 'pos' ? 'text-risk-safe-strong' : 'text-muted-foreground'
                      }`}
                    >
                      {f.impact === 'pos' ? 'lowers risk' : f.impact === 'neg' ? 'raises risk' : 'neutral'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {state.kind === 'found' && state.similar.length > 0 && (
              <Card className="gap-0 p-6">
                <h3 className="text-[15px] font-semibold text-foreground">Similar buyers</h3>
                <p className="mt-1 mb-3 text-[13px] text-muted-foreground">
                  Buyers whose behaviour looks closest to this one, by fingerprint. Resemblance is not a risk
                  verdict, and it is never evidence of fraud.
                </p>
                <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
                  {state.similar.map((s, i) => (
                    <li key={i} className="flex min-h-11 flex-wrap items-center gap-3 py-3">
                      <span className="text-[13px] font-semibold text-foreground">
                        {Math.round((1 - Math.min(1, Math.max(0, Number(s.similarity) || 0))) * 100)}% alike
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        {s.total_orders ?? 0} orders · {s.total_refused ?? 0} refused
                      </span>
                      <span className="ms-auto">
                        <VerdictBadge riskScore={s.risk_score} totalOrders={s.total_orders} />
                      </span>
                    </li>
                  ))}
                </ul>
                {/* The server does not return these buyers' numbers, so they
                    cannot be opened from here. That is deliberate. */}
                <p className="mt-3 text-[11.5px] text-muted-foreground">
                  Verafo does not show other buyers&rsquo; phone numbers, so these cannot be opened. To check one,
                  look it up with a number you already have.
                </p>
              </Card>
            )}

            <Card className="gap-0 p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold text-foreground">AI assist</h3>
                {buyer.embedding ? (
                  <span className="rounded-full border border-risk-safe/40 bg-risk-safe-soft px-2.5 py-1 text-[13px] font-medium text-risk-safe-strong">
                    fingerprint embedded
                  </span>
                ) : (
                  <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[13px] font-medium text-muted-foreground">
                    no fingerprint yet
                  </span>
                )}
              </div>
              {explanation && <p className="mb-3 text-[15px] text-muted-foreground">{explanation}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={!aiEnabled || explaining} onClick={() => void explain(buyer)}>
                  {explaining ? <Icon name="refresh" size={15} className="spin" /> : <Icon name="sparkles" size={15} />}
                  Explain this buyer
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={!aiEnabled || embeddingBusy}
                  onClick={() => void refreshEmbedding(buyer)}
                >
                  {embeddingBusy ? <Icon name="refresh" size={15} className="spin" /> : <Icon name="fingerprint" size={15} />}
                  Refresh fingerprint
                </button>
              </div>
              {!aiEnabled && (
                <p className="mt-3 text-[13px] text-muted-foreground">
                  Deploy the <code>verafo-ai</code> edge function to enable AI explanations and embeddings.
                </p>
              )}
            </Card>
          </div>

          {/* Details: the order history. */}
          <div className="flex flex-col gap-6 lg:col-span-5">
            <Card className="gap-0 p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold text-foreground">Order history</h3>
                <span className="font-mono text-[13px] text-muted-foreground">
                  {orders.length} order{orders.length === 1 ? '' : 's'}
                </span>
              </div>
              {orders.length === 0 ? (
                <EmptyState
                  icon="package"
                  title="No orders yet"
                  detail="This buyer has never placed an order in the network."
                />
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {orders.map((o) => (
                    <li key={o.id} className="flex flex-col gap-1.5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-medium text-foreground">
                          {o.product_name || o.product_category || 'Untitled product'}
                        </span>
                        <StatusBadge status={o.outcomes?.status ?? 'pending'} />
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                        <span>{o.stores?.name ?? 'Unknown store'}</span>
                        <span className="tabular-nums">
                          {money(o.price)}
                          {o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}
                        </span>
                        <span>{o.city ?? '—'}</span>
                        <span>{dateTime(o.ordered_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </Reveal>
      )}
    </PageShell>
  )
}
