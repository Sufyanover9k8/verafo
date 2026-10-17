import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Fingerprint, Loader2, Lock, MessageSquare, ScanSearch, Sparkles, Trash2, Users } from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { VerdictBadge } from '../components/app/verdict-badge'
import { StatusBadge } from '../components/app/status-badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '../components/primitives/Skeleton'
import { Avatar } from '../components/Avatar'
import { Reveal } from '../components/Reveal'
import { EmptyState, NeedsSetup } from '../components/States'
import { cn } from '@/lib/utils'
import { dateTime, money, normalizePhone, phone, timeAgo } from '../lib/format'
import { computeVerdict, riskFactors, toneFromScore, type VerdictTone } from '../lib/risk'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { aiJson, classifyAiThrow } from '../lib/ai'
import { hasFingerprint } from '../lib/ui/fingerprint'
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
  /**
   * Whether the buyer has an AI fingerprint stored. A flag, not the vector:
   * before this existed the page hard-coded "no fingerprint", so the badge
   * reported a constant instead of the buyer's state.
   */
  has_fingerprint?: boolean | null
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
  'h-11 w-full rounded-[10px] border border-input bg-card px-3 font-mono text-[16px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)] md:text-[15px]'

/**
 * The similarity score comes back as a distance, so it is shown inverted as a
 * percentage. Clamped and defaulted, because a missing or out-of-range value
 * must never render as `NaN%`.
 */
function alikePercent(s: SimilarBuyer): number {
  return Math.round((1 - Math.min(1, Math.max(0, Number(s.similarity) || 0))) * 100)
}

/** Risk-band fills for the similar-buyers mix. One place, so the bar and its
 *  legend can never disagree. */
const SIMILAR_TONE: Record<'safe' | 'watch' | 'high' | 'unknown', { bar: string }> = {
  safe: { bar: 'bg-risk-safe' },
  watch: { bar: 'bg-risk-watch' },
  high: { bar: 'bg-risk-high' },
  unknown: { bar: 'bg-risk-unknown' },
}

/** Prompts worth one tap, each finished with the buyer's number by the caller. */
const BUYER_PROMPTS = [
  'Why does this buyer score the way they do?',
  'Should I ship their next order?',
  'What does their order history look like?',
]

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
        /*
         * The vector itself never reaches the browser, so `embedding` stays
         * empty — but the server now reports whether one exists. Without that
         * flag the badge could only ever say "no fingerprint yet". The flag is
         * authoritative when present; see the direct check in `search` for the
         * case where the SQL that adds it has not been applied.
         */
        has_fingerprint: Boolean(network.has_fingerprint),
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

      /*
       * Confirm the fingerprint directly from the buyers row.
       *
       * `buyer_network_lookup.has_fingerprint` is authoritative, but that column
       * only exists once supabase/lookup-fingerprint-flag.sql has been applied.
       * Until then the badge would read a permanently-false default. Asking the
       * table for the one boolean settles it today, and RLS keeps the answer
       * honest per caller. If neither source can answer, the flag stays false
       * rather than claiming a fingerprint we cannot see.
       */
      const direct = await hasFingerprint(normalized)
      if (direct !== null) buyer.has_fingerprint = direct

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

  /**
   * Ask the verafo-ai function for a one-sentence explanation.
   *
   * The contract is `action: "explain"` with the phone number at the TOP LEVEL:
   * the function reads `body.phone` before it dispatches, and `fetchStats` uses
   * that number to build the profile. This call used to send `mode: "explain"`
   * with the buyer nested under `buyer`, so `body.phone` was empty and the
   * function answered 400 — the button could never have worked.
   */
  async function explain(buyer: Buyer) {
    if (!supabase) return
    setExplaining(true)
    try {
      const json = await aiJson<{ text?: string; error?: string }>('explain', { phone: buyer.phone })
      if (json.error) throw new Error(json.error)
      setExplanation(json.text ?? null)
    } catch (err) {
      const failure = classifyAiThrow(err)
      toast.push({ kind: 'error', title: 'Could not explain this buyer', detail: failure.detail })
    } finally {
      setExplaining(false)
    }
  }

  async function refreshEmbedding(buyer: Buyer) {
    if (!supabase) return
    setEmbeddingBusy(true)
    try {
      // Same correction as `explain`: the action name, phone at top level.
      await aiJson('embed', { phone: buyer.phone })
      toast.push({ kind: 'success', title: 'Fingerprint refreshed' })
      void search(buyer.phone)
    } catch (err) {
      const failure = classifyAiThrow(err)
      toast.push({ kind: 'error', title: 'Could not refresh the fingerprint', detail: failure.detail })
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

  /** How this buyer's lookalikes split across the risk bands. Counted from the
   *  rows the server returned, so the bar can never claim more than we have. */
  const SIMILAR_BANDS = (() => {
    const list = state.kind === 'found' ? state.similar : []
    const counts: Record<'safe' | 'watch' | 'high' | 'unknown', number> = { safe: 0, watch: 0, high: 0, unknown: 0 }
    for (const s of list) counts[toneFromScore(Number(s.risk_score) || 0)]++
    return [
      { tone: 'safe' as const, label: 'LOW', n: counts.safe },
      { tone: 'watch' as const, label: 'MEDIUM', n: counts.watch },
      { tone: 'high' as const, label: 'HIGH', n: counts.high },
      { tone: 'unknown' as const, label: 'UNKNOWN', n: counts.unknown },
    ]
  })()

  return (
    <PageShell>
      <PageHeader
        title="Buyer Lookup"
        description="Type any phone number to see its full cross-store profile and risk score."
      />

      {/* One clear search box, first on the page. */}
      <Card className="gap-0 p-6">
        <form onSubmit={handleSearch}>
          <div className="flex flex-col gap-2">
            <label htmlFor="buyer-phone" className="text-[15px] font-semibold text-foreground">
              Enter a buyer&rsquo;s phone number
            </label>
            <p className="text-[13px] text-muted-foreground" id="buyer-phone-help">
              Any Pakistani mobile number, with or without the country code. The result is a network-wide
              aggregate — totals, stores, timeline and risk score.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="buyer-phone"
                className={inputClass}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="0301 234 5678"
                aria-describedby="buyer-phone-help"
              />
              <Button type="submit" className="h-11 shrink-0 gap-2 rounded-full px-5" disabled={state.kind === 'loading'}>
                {state.kind === 'loading' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ScanSearch className="size-4" />
                )}
                Look up
              </Button>
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Enter at least 6 digits. Verafo never shows another buyer&rsquo;s phone number.
            </p>
          </div>
        </form>
      </Card>

      {/* Before the first search. */}
      {state.kind === 'idle' && recents.length > 0 && (
        <Card className="gap-0 p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Recent lookups</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">Only you can see this list.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 gap-1.5 px-3 md:h-9"
              onClick={() => void clearAll()}
            >
              <Trash2 className="size-3.5" /> Clear
            </Button>
          </div>
          <Reveal stagger className="flex flex-col gap-1">
            {recents.map((r) => (
              <button
                key={r.id}
                type="button"
                className="flex min-h-11 flex-wrap items-center gap-3 rounded-[10px] px-2 py-2.5 text-start transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)]"
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
        <Card className="gap-3 p-6" aria-busy="true">
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
            <Button
              type="button"
              variant="outline"
              className="h-11 px-4"
              onClick={() => {
                setState({ kind: 'idle' })
                setInput('')
              }}
            >
              Try another number
            </Button>
          </div>
        </Card>
      )}

      {buyer && verdict && (
        <Reveal stagger className="grid gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-6 lg:col-span-7">
            {/* Verdict first. */}
            <Card className="gap-4 p-6">
              <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Network profile
              </p>
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
                <div className="mb-1 flex flex-wrap items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-accent text-accent-foreground">
                    <Users className="size-4" aria-hidden="true" />
                  </span>
                  <h3 className="text-[15px] font-semibold text-foreground">Similar buyers</h3>
                </div>
                <p className="mb-4 text-[13px] text-muted-foreground">
                  The{' '}
                  <strong className="font-semibold text-foreground">
                    {state.similar.length} closest
                  </strong>{' '}
                  match{state.similar.length === 1 ? '' : 'es'} in the Verafo network, found by AI fingerprint.
                  Resemblance is not a risk verdict and is never evidence of fraud.
                </p>

                {/* How the lookalikes split across risk bands — the shape of the
                    group at a glance, with every colour named in the legend. */}
                <div className="mb-1 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Risk mix of similar buyers">
                  {SIMILAR_BANDS.filter((b) => b.n > 0).map((b) => (
                    <div key={b.tone} className={cn('h-full', SIMILAR_TONE[b.tone].bar)} style={{ width: `${(b.n / state.similar.length) * 100}%` }} />
                  ))}
                </div>
                <ul className="m-0 mb-4 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
                  {SIMILAR_BANDS.filter((b) => b.n > 0).map((b) => (
                    <li key={b.tone} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      <span className={cn('size-2.5 rounded-full', SIMILAR_TONE[b.tone].bar)} aria-hidden="true" />
                      {b.label}
                      <span className="font-semibold text-foreground tabular-nums">{b.n}</span>
                    </li>
                  ))}
                </ul>

                <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
                  {state.similar.map((s, i) => (
                    <li key={i} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
                      <span className="font-mono text-[13.5px] font-semibold tabular-nums text-foreground">
                        {alikePercent(s)}%
                      </span>
                      <span className="text-[12.5px] text-muted-foreground">alike</span>
                      <span className="text-[12.5px] text-muted-foreground">
                        {s.total_orders ?? 0} order{(s.total_orders ?? 0) === 1 ? '' : 's'}
                      </span>
                      {(s.total_refused ?? 0) > 0 && (
                        <span className="text-[12.5px] font-medium text-risk-high-strong">
                          {s.total_refused} refused
                        </span>
                      )}
                      <span className="ms-auto">
                        <VerdictBadge riskScore={s.risk_score} totalOrders={s.total_orders} />
                      </span>
                    </li>
                  ))}
                </ul>

                {/* The server does not return these buyers' numbers, so they
                    cannot be opened from here. That is deliberate. */}
                <div className="mt-3 flex items-start gap-2.5 rounded-[10px] border border-border bg-muted/40 p-3">
                  <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <p className="text-[12.5px] text-muted-foreground">
                    Verafo never shows another buyer&rsquo;s phone number, so these cannot be opened. To check one,
                    look it up with a number you already have.
                  </p>
                </div>
              </Card>
            )}

            <Card className="gap-0 p-6">
              <div className="mb-1 flex flex-wrap items-center gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-accent text-accent-foreground">
                  <Sparkles className="size-4" aria-hidden="true" />
                </span>
                <h3 className="text-[15px] font-semibold text-foreground">Ask Verafo about this buyer</h3>
                {buyer.has_fingerprint ? (
                  <span className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-risk-safe/40 bg-risk-safe-soft px-2.5 py-1 text-[12.5px] font-medium text-risk-safe-strong">
                    <Fingerprint className="size-3.5" /> fingerprint embedded
                  </span>
                ) : (
                  <span
                    className="ms-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[12.5px] font-medium text-muted-foreground"
                    title="A fingerprint is the buyer's AI similarity vector. Explanations and lookups work without one; only the 'similar buyers' comparison needs it."
                  >
                    <Fingerprint className="size-3.5" /> no fingerprint yet
                  </span>
                )}
              </div>
              <p className="mb-4 text-[13px] text-muted-foreground">
                {aiEnabled
                  ? 'Verafo can read this buyer’s history and answer in plain language. These actions never change the score themselves.'
                  : 'Deploy the verafo-ai edge function to enable AI explanations, embeddings and chat about a buyer.'}
              </p>

              {explanation && (
                <div className="mb-4 rounded-[10px] border border-risk-safe/40 bg-risk-safe-soft p-4">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-semibold tracking-[0.12em] text-risk-safe-strong uppercase">
                    <Sparkles className="size-3.5" aria-hidden="true" /> Verafo&rsquo;s explanation
                  </p>
                  <p className="text-[14px] leading-relaxed text-foreground">{explanation}</p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className="h-11 gap-1.5 px-4 md:h-9"
                  disabled={!aiEnabled || explaining}
                  onClick={() => void explain(buyer)}
                >
                  {explaining ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  Explain this buyer
                </Button>
                <Button asChild variant="outline" className="h-11 gap-1.5 px-4 md:h-9">
                  <Link to={`/chat?q=${encodeURIComponent(`Tell me about buyer ${buyer.phone} — ${verdict.label} risk. Should I ship to them?`)}`}>
                    <MessageSquare className="size-3.5" /> Ask Verafo
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 gap-1.5 px-4 md:h-9"
                  disabled={!aiEnabled || embeddingBusy}
                  onClick={() => void refreshEmbedding(buyer)}
                >
                  {embeddingBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Fingerprint className="size-3.5" />}
                  Refresh fingerprint
                </Button>
              </div>

              {/* One tap into the assistant, each carrying this buyer's number. */}
              <p className="mt-4 mb-2 text-[11.5px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                Or ask
              </p>
              <div className="flex flex-wrap gap-2">
                {BUYER_PROMPTS.map((p) => (
                  <Link
                    key={p}
                    to={`/chat?q=${encodeURIComponent(`${p} Buyer ${buyer.phone}.`)}`}
                    className="inline-flex h-11 items-center rounded-full border border-border bg-card px-3 text-[12.5px] text-foreground transition-colors hover:bg-muted md:h-8"
                  >
                    {p}
                  </Link>
                ))}
              </div>
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
                  detail={
                    store
                      ? `${store.name} has no order for this buyer. Their network totals above may come from other stores.`
                      : 'This buyer has never placed an order in the network.'
                  }
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
