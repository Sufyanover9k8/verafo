import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { VerdictBlock } from '../components/verdict/VerdictBlock'
import { VerdictChip } from '../components/verdict/VerdictChip'
import { Card } from '../components/primitives/Card'
import { Skeleton } from '../components/primitives/Skeleton'
import { Avatar } from '../components/Avatar'
import { Reveal } from '../components/Reveal'
import { EmptyState, NeedsSetup } from '../components/States'
import { dateTime, money, normalizePhone, phone, timeAgo } from '../lib/format'
import { riskFactors } from '../lib/risk'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import type { Buyer, OrderRow, SimilarBuyer } from '../lib/types'

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

/** What buyer_network_lookup returns. Aggregates only — no identity. */
interface NetworkLookupRow {
  risk_score: number | null
  total_orders: number | null
  total_accepted: number | null
  total_refused: number | null
  store_count: number | null
  first_seen: string | null
}

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

      // PRIVACY: this used to run `from('buyers').select('*')`, which pulled the
      // raw embedding and feature vector into the browser, and it called
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
    [toast, loadRecents, store, email],
  )

  useEffect(() => {
    const phoneParam = params.get('phone')
    if (phoneParam) {
      if (normalizePhone(phoneParam) !== searched) void search(phoneParam)
      setInput(phoneParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, searched])

  function handleSearch(e: FormEvent) {
    e.preventDefault()
    void search(input)
    setParams(input ? { phone: normalizePhone(input) } : {})
  }

  function openRecent(p: string) {
    setInput(p)
    setParams({ phone: p })
    void search(p)
  }

  async function clearAll() {
    if (!supabase || !email) return
    const { error } = await supabase.from('lookups').delete().eq('owner_email', email)
    if (error) {
      toast.push({ kind: 'error', title: 'Could not clear history', detail: error.message })
      return
    }
    setRecents([])
  }

  async function explain(buyer: Buyer) {
    const base = functionsBaseUrl()
    if (!base) return
    setExplaining(true)
    setExplanation(null)
    try {
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'explain', phone: buyer.phone }),
      })
      const json = (await res.json()) as { text?: string; error?: string }
      if (!res.ok || !json.text) throw new Error(json.error ?? 'Request failed')
      setExplanation(json.text)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({
        kind: 'error',
        title: 'AI explain failed',
        detail: `${message} — is the verafo-ai edge function deployed with an OpenAI key?`,
      })
    } finally {
      setExplaining(false)
    }
  }

  async function refreshEmbedding(buyer: Buyer) {
    const base = functionsBaseUrl()
    if (!base) return
    setEmbeddingBusy(true)
    try {
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'embed', phone: buyer.phone }),
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Request failed')
      toast.push({ kind: 'success', title: 'AI fingerprint refreshed', detail: 'Embedding updated for this buyer.' })
      await search(buyer.phone)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({
        kind: 'error',
        title: 'Embedding failed',
        detail: `${message} — is the verafo-ai edge function deployed with an OpenAI key?`,
      })
    } finally {
      setEmbeddingBusy(false)
    }
  }

  if (!isConfigured) return <NeedsSetup />

  const buyer = state.kind === 'found' ? state.buyer : null
  const orders = state.kind === 'found' ? state.orders : []
  const aiEnabled = Boolean(functionsBaseUrl())

  return (
    <div className="stack">
      <PageHeader
        icon="search"
        title="Buyer Lookup"
        subtitle="Type any phone number to see its full cross-store profile and risk score."
      />

      <form className="lookup-search card" onSubmit={handleSearch}>
        <Icon name="search" size={20} className="search-icon" />
        <input
          type="tel"
          inputMode="tel"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0301 234 5678"
          aria-label="Buyer phone number"
        />
        <button type="submit" className="btn btn-primary">
          <Icon name="arrow-forward" size={16} /> Look up
        </button>
      </form>

      {state.kind === 'idle' && recents.length > 0 && (
        <Card>
          <div className="recent-head">
            <h3 className="card-title">
              <Icon name="time" size={16} /> Recent lookups
            </h3>
            <button className="recent-clear" onClick={() => void clearAll()} title="Clear history">
              <Icon name="trash" size={15} />
            </button>
          </div>
          <Reveal stagger className="recent-list">
            {recents.map((r) => {
              return (
                <button key={r.id} className="recent-row" onClick={() => openRecent(r.buyer_phone)}>
                  <Avatar phone={r.buyer_phone} size={26} />
                  <span className="recent-phone">{phone(r.buyer_phone)}</span>
                  <VerdictChip risk_score={r.buyers?.risk_score ?? 0.5} total_orders={r.buyers?.total_orders ?? 0} />
                  <span className="recent-when">{timeAgo(r.searched_at)}</span>
                </button>
              )
            })}
          </Reveal>
        </Card>
      )}

      {state.kind === 'idle' && recents.length === 0 && (
        <Card>
          <EmptyState
            icon="fingerprint"
            title="Enter a phone number"
            detail="Search the network-wide profile: totals, stores, timeline and risk score."
          />
        </Card>
      )}

      {state.kind === 'loading' && (
        <div className="card">
          <div className="stack">
            <Skeleton width="40%" height={18} />
            <Skeleton width="65%" height={12} />
            <Skeleton width="50%" height={12} />
            <Skeleton width="30%" height={12} />
          </div>
        </div>
      )}

      {state.kind === 'not-found' && (
        <Card>
          <EmptyState
            icon="person"
            title="No buyer found"
            detail={`No profile exists for ${phone(searched)} yet. Log their first order to create one.`}
          />
        </Card>
      )}

      {buyer && (
        <Reveal stagger className="grid-12">
          <section className="col-7 stack">
            <VerdictBlock
              risk_score={buyer.risk_score}
              total_orders={buyer.total_orders}
              total_accepted={buyer.total_accepted}
              total_refused={buyer.total_refused}
              stores={new Set(orders.map((o) => o.store_id)).size}
              firstSeen={buyer.first_seen}
            />

            <Card>
              <div className="verdict-panel-head">
                <h3 className="card-title">Signals</h3>
                <span className="verdict-conf">+ lowers risk · − raises</span>
              </div>
              <div className="factor-list">
                {riskFactors({ ...buyer, orders }).map((f, i) => (
                  <div className="factor-row" key={i}>
                    <span className="factor-label">{f.label}</span>
                    <span className={`factor-impact ${f.impact}`}>
                      {f.impact === 'pos' ? '+' : f.impact === 'neg' ? '−' : '·'}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {state.kind === 'found' && state.similar.length > 0 && (
              <Card>
                <h3 className="card-title">
                  <Icon name="git-compare" size={16} /> Behaviourally similar buyers
                </h3>
                <p className="card-sub">
                  Closest behaviour to this buyer, by fingerprint. The network never returns these
                  buyers' phone numbers, so they cannot be opened from here — look one up with a
                  number you already have.
                </p>
                <Reveal stagger className="similar-list">
                  {state.similar.map((s, i) => (
                    <div key={i} className="similar-row">
                      <span className="similar-meta">
                        {Math.round((1 - Math.min(1, Math.max(0, Number(s.similarity) || 0))) * 100)}% alike ·{' '}
                        {s.total_orders ?? 0} orders · {s.total_refused ?? 0} refused
                      </span>
                      <VerdictChip risk_score={s.risk_score} total_orders={s.total_orders} />
                    </div>
                  ))}
                </Reveal>
              </Card>
            )}

            <div className="ai-box">
              <div className="ai-box-head">
                <span className="ai-title">
                  <Icon name="sparkles" size={15} /> AI assist
                </span>
                {buyer.embedding ? (
                  <span className="chip chip-green">
                    <Icon name="fingerprint" size={12} /> fingerprint embedded
                  </span>
                ) : (
                  <span className="chip">no fingerprint yet</span>
                )}
              </div>
              {explanation && <p className="ai-text">{explanation}</p>}
              <div className="ai-actions">
                <button className="btn btn-ghost" disabled={!aiEnabled || explaining} onClick={() => void explain(buyer)}>
                  {explaining ? <Icon name="refresh" size={15} className="spin" /> : <Icon name="sparkles" size={15} />}
                  Explain this buyer
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={!aiEnabled || embeddingBusy}
                  onClick={() => void refreshEmbedding(buyer)}
                >
                  {embeddingBusy ? (
                    <Icon name="refresh" size={15} className="spin" />
                  ) : (
                    <Icon name="fingerprint" size={15} />
                  )}
                  Refresh fingerprint
                </button>
              </div>
              {!aiEnabled && (
                <p className="ai-hint">
                  Deploy the <code>verafo-ai</code> edge function to enable AI explanations and embeddings.
                </p>
              )}
            </div>
          </section>

          <section className="col-5">
            <Card>
              <div className="verdict-panel-head">
                <h3 className="card-title">Order history</h3>
                <span className="verdict-conf">{orders.length} order{orders.length === 1 ? '' : 's'}</span>
              </div>
              {orders.length === 0 ? (
                <EmptyState
                  icon="package"
                  title="No orders yet"
                  detail="This buyer has never placed an order in the network."
                />
              ) : (
                <div className="timeline">
                  {orders.map((o) => {
                    const status = o.outcomes?.status ?? 'pending'
                    return (
                      <div key={o.id} className="timeline-item">
                        <div className={`timeline-dot ${status === 'accepted' ? 'ok' : ''} ${status === 'refused' ? 'bad' : ''} ${status === 'pending' ? 'pending' : ''}`}>
                          <Icon
                            name={status === 'accepted' ? 'check' : status === 'refused' ? 'close' : 'hourglass'}
                            size={13}
                          />
                        </div>
                        <div className="timeline-content">
                          <div className="timeline-top">
                            <span className="timeline-product">
                              {o.product_name || o.product_category || 'Untitled product'}
                            </span>
                            {o.product_category && <span className="chip">{o.product_category}</span>}
                            {status === 'accepted' && <span className="pill pill-ok">Accepted</span>}
                            {status === 'refused' && <span className="pill pill-bad">Refused</span>}
                            {status === 'pending' && <span className="pill pill-pending">Pending</span>}
                          </div>
                          <div className="timeline-meta">
                            <span>
                              <Icon name="storefront" size={13} /> {o.stores?.name ?? 'Unknown store'}
                            </span>
                            <span>
                              <Icon name="card" size={13} /> {money(o.price)}
                              {o.quantity && o.quantity > 1 ? ` x ${o.quantity}` : ''}
                            </span>
                            <span>
                              <Icon name="location" size={13} /> {o.city ?? '—'}
                              {o.address ? ` · ${o.address}` : ''}
                            </span>
                            <span>
                              <Icon name="time" size={13} /> {dateTime(o.ordered_at)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </section>
        </Reveal>
      )}
    </div>
  )
}