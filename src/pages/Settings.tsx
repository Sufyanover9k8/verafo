import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/PageHeader'
import { NeedsSetup } from '../components/States'
import { dateOnly } from '../lib/format'
import { getProfile, saveProfile } from '../lib/profile'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { useTheme, type Theme } from '../lib/theme'
import { useToast } from '../lib/toast'

function download(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const keys = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n')
}

export function Settings() {
  const toast = useToast()
  const { theme, reducedMotion, resolved, setTheme, setReducedMotion } = useTheme()
  const [exporting, setExporting] = useState<'buyers' | 'orders' | null>(null)
  const [clearing, setClearing] = useState(false)
  const [conn, setConn] = useState<'checking' | 'ok' | 'fail'>('checking')
  const [buyerCount, setBuyerCount] = useState<number | null>(null)
  const [orderCount, setOrderCount] = useState<number | null>(null)
  const [name, setName] = useState<string>(() => getProfile().name)

  useEffect(() => {
    if (!supabase) {
      setConn('fail')
      return
    }
    const base = functionsBaseUrl()
    let cancelled = false
    Promise.all([
      supabase.from('buyers').select('id', { count: 'exact', head: true }),
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    ]).then(([b, o]) => {
      if (cancelled) return
      if (b.error || o.error) setConn('fail')
      else {
        setBuyerCount(b.count)
        setOrderCount(o.count)
        setConn('ok')
      }
    })
    if (base) {
      fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suggest' }),
      })
        .then((r) => r.json())
        .then((j: { ok?: boolean }) => {
          if (!cancelled && !j.ok) setConn('fail')
        })
        .catch(() => {
          if (!cancelled) setConn('fail')
        })
    }
    return () => {
      cancelled = true
    }
  }, [])

  const exportBuyers = useCallback(async () => {
    if (!supabase) return
    setExporting('buyers')
    try {
      const { data, error } = await supabase.from('buyers').select('*').order('phone')
      if (error) throw error
      const rows = (data ?? []).map((b) => ({
        phone: b.phone,
        risk_score: b.risk_score,
        total_orders: b.total_orders,
        total_accepted: b.total_accepted,
        total_refused: b.total_refused,
        first_seen: dateOnly(b.first_seen),
      }))
      download(`verafo-buyers-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows))
      toast.push({ kind: 'success', title: 'Buyers exported', detail: `${rows.length} rows downloaded.` })
    } catch (err) {
      toast.push({ kind: 'error', title: 'Export failed', detail: err instanceof Error ? err.message : String(err) })
    } finally {
      setExporting(null)
    }
  }, [toast])

  const exportOrders = useCallback(async () => {
    if (!supabase) return
    setExporting('orders')
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, stores(name), outcomes(status)')
        .order('ordered_at', { ascending: false })
        .limit(2000)
      if (error) throw error
      const rows = (data ?? []).map((o) => ({
        buyer_phone: o.buyer_phone,
        store: o.stores?.name ?? '',
        product_category: o.product_category ?? '',
        product_name: o.product_name ?? '',
        price: o.price ?? '',
        quantity: o.quantity ?? '',
        city: o.city ?? '',
        ordered_at: o.ordered_at,
        outcome: o.outcomes?.status ?? 'pending',
      }))
      download(`verafo-orders-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows))
      toast.push({ kind: 'success', title: 'Orders exported', detail: `${rows.length} rows downloaded.` })
    } catch (err) {
      toast.push({ kind: 'error', title: 'Export failed', detail: err instanceof Error ? err.message : String(err) })
    } finally {
      setExporting(null)
    }
  }, [toast])

  const clearLookups = useCallback(async () => {
    if (!supabase) return
    setClearing(true)
    try {
      const { error } = await supabase.from('lookups').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (error) throw error
      toast.push({ kind: 'success', title: 'History cleared', detail: 'Recent lookups were removed.' })
    } catch (err) {
      toast.push({ kind: 'error', title: 'Could not clear history', detail: err instanceof Error ? err.message : String(err) })
    } finally {
      setClearing(false)
    }
  }, [toast])

  const saveName = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim().slice(0, 40)
    setName(trimmed)
    saveProfile({ name: trimmed })
    toast.push({
      kind: 'success',
      title: 'Saved',
      detail: trimmed ? `Greeting will use “${trimmed.split(/\s+/)[0]}”.` : 'Greeting is back to impersonal.',
    })
  }

  if (!isConfigured || !supabase) return <NeedsSetup />

  return (
    <div>
      <PageHeader
        icon="settings-outline"
        title="Settings"
        subtitle="Appearance, data and connection — everything in one place."
      />

      <div className="settings-layout">
        <section className="card settings-section">
          <span className="eyebrow">Personal information</span>
          <div className="settings-rows">
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Your name</div>
                <div className="setting-desc">Used for the personalised greeting on the dashboard.</div>
              </div>
              <form className="setting-control" onSubmit={saveName}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ali"
                  maxLength={40}
                  aria-label="Your name"
                />
                <button className="btn btn-ghost btn-sm" type="submit">
                  Save
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="card settings-section">
          <span className="eyebrow">Appearance</span>
          <div className="settings-rows">
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Theme</div>
                <div className="setting-desc">Choose how Verafo looks. System follows your device.</div>
              </div>
              <div className="seg" role="group" aria-label="Theme">
                {(['dark', 'light', 'system'] as Theme[]).map((t) => (
                  <button
                    key={t}
                    className={theme === t ? 'active' : ''}
                    onClick={() => setTheme(t)}
                    title={t === 'system' ? `Resolved: ${resolved}` : undefined}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Reduced motion</div>
                <div className="setting-desc">Disable animations and transitions.</div>
              </div>
              <button
                className={`switch${reducedMotion ? ' on' : ''}`}
                role="switch"
                aria-checked={reducedMotion}
                onClick={() => setReducedMotion(!reducedMotion)}
              />
            </div>
          </div>
        </section>

        <section className="card settings-section">
          <span className="eyebrow">Data</span>
          <div className="settings-rows">
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Export buyers</div>
                <div className="setting-desc">
                  Download all {buyerCount ?? '…'} buyer profiles as a CSV.
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={exporting !== null} onClick={() => void exportBuyers()}>
                {exporting === 'buyers' ? <Icon name="refresh-outline" size={14} className="spin" /> : <Icon name="download-outline" size={14} />}
                Export CSV
              </button>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Export orders</div>
                <div className="setting-desc">
                  Download up to 2000 orders (with store and outcome) as a CSV.
                </div>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={exporting !== null} onClick={() => void exportOrders()}>
                {exporting === 'orders' ? <Icon name="refresh-outline" size={14} className="spin" /> : <Icon name="download-outline" size={14} />}
                Export CSV
              </button>
            </div>

            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Clear lookup history</div>
                <div className="setting-desc">
                  Remove all recent lookups from the Buyer Lookup page.
                </div>
              </div>
              <button className="btn btn-refuse btn-sm" disabled={clearing} onClick={() => void clearLookups()}>
                {clearing ? <Icon name="refresh-outline" size={14} className="spin" /> : <Icon name="trash-outline" size={14} />}
                Clear history
              </button>
            </div>
          </div>
        </section>

        <section className="card settings-section">
          <span className="eyebrow">Connection</span>
          <div className="conn-card">
            <div className="conn-avatar">
              <Icon name="server-outline" size={20} />
            </div>
            <div className="conn-meta">
              <strong>Supabase {conn === 'ok' ? 'connected' : conn === 'checking' ? 'checking…' : 'unreachable'}</strong>
              <span>
                {isConfigured ? new URL(functionsBaseUrl() ?? '').host : 'not configured'} ·{' '}
                {buyerCount != null ? `${buyerCount} buyers · ${orderCount} orders` : 'loading counts…'}
              </span>
            </div>
            <span className={`conn-pill${conn === 'ok' ? '' : ' warn'}`}>
              <span className="conn-dot" />
              {conn === 'ok' ? 'online' : conn === 'checking' ? 'checking' : 'offline'}
            </span>
          </div>
        </section>

        <section className="card settings-section">
          <span className="eyebrow">About</span>
          <div className="about-brand">
            <span className="brand-mark">
              <Icon name="shield-checkmark" size={20} />
            </span>
            <div>
              <h3>Verafo</h3>
              <p>COD risk intelligence · v0.2 · Supabase + OpenAI edge functions</p>
            </div>
          </div>
          {!functionsBaseUrl() && (
            <div className="ai-hint" style={{ marginTop: 14 }}>
              Deploy the <code>verafo-ai</code> edge function to unlock chat, analysis and AI
              explanations.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
