import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { CardState } from '../components/app/card-state'
import { OrderImport } from '../components/app/order-import'
import { canExportAudience, exportAudienceCsv, type AudienceBuyer } from '../lib/ui/audiences'
import { PageHeader } from '../components/app/page-header'
import { NeedsSetup } from '../components/States'
import { useIsAdmin } from '../lib/admin'
import { useStoreScope } from '../lib/store'
import { overageCallPkr, overagePkr, readCreditStatus, type CreditStatus } from '../lib/credits'
import { readCallSettings, saveCallSettings, thresholdLabel, type CallSettings } from '../lib/calls'
import { isConfigured, supabase } from '../lib/supabase'
import { LOGIN_PATH } from '../lib/ui/auth-redirect'
import { useSession } from '../lib/session'
import { useTheme, type Theme } from '../lib/theme'
import { useToast } from '../lib/toast'

/** Risk thresholds offered for automated calls — matches the mobile app. */
const CALL_THRESHOLDS = [0.35, 0.5, 0.65, 0.8]

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
  const navigate = useNavigate()
  const { admin } = useIsAdmin()
  const { store } = useStoreScope()
  const { displayName, user } = useSession()
  const { theme, reducedMotion, resolved, setTheme, setReducedMotion } = useTheme()
  const [exporting, setExporting] = useState<'buyers' | 'orders' | null>(null)
  const [clearing, setClearing] = useState(false)
  const [ready, setReady] = useState(false)
  const [buyerCount, setBuyerCount] = useState<number | null>(null)
  const [dangerOpen, setDangerOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [name, setName] = useState<string>(displayName)
  const [savingName, setSavingName] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  /** Calling: the threshold + budget the automated call queue reads. */
  const [calls, setCalls] = useState<CallSettings | null>(null)
  const [callsLoading, setCallsLoading] = useState(true)
  const [savingCalls, setSavingCalls] = useState<'auto' | 'threshold' | null>(null)
  const [credits, setCredits] = useState<CreditStatus | null>(null)

  useEffect(() => {
    setName(displayName)
  }, [displayName])

  // Plan and credit use for this month, refreshed whenever the store changes.
  useEffect(() => {
    if (!store?.id) return
    let alive = true
    readCreditStatus(store.id)
      .then((next) => {
        if (alive) setCredits(next)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [store?.id])

  useEffect(() => {
    let alive = true
    readCallSettings()
      .then(({ settings, stores }) => {
        if (!alive) return
        const row =
          (store ? settings?.find((s) => s.store_id === store.id) : undefined) ??
          settings?.find((s) => s.store_id === stores?.[0]?.id) ??
          null
        setCalls(row)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setCallsLoading(false)
      })
    return () => {
      alive = false
    }
  }, [store])

  async function saveCalls(
    patch: Partial<Pick<CallSettings, 'auto_call' | 'risk_threshold'>>,
    which: 'auto' | 'threshold',
  ) {
    if (!calls) return
    setSavingCalls(which)
    try {
      const res = await saveCallSettings(calls.store_id, patch)
      setCalls(res.settings ?? { ...calls, ...patch })
      const threshold = thresholdLabel(Number(res.settings?.risk_threshold ?? calls.risk_threshold))
      toast.push({
        kind: 'success',
        title:
          which === 'auto'
            ? calls.auto_call
              ? 'Automated calls are off'
              : `Automated calls are on — ${threshold} risk and above`
            : which === 'threshold'
              ? `Calls now start at ${threshold} risk`
              : 'Call budget saved',
      })
    } catch (error) {
      toast.push({
        kind: 'error',
        title: 'Could not save calling settings',
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSavingCalls(null)
    }
  }

  useEffect(() => {
    if (!supabase) {
      setReady(true)
      return
    }
    let cancelled = false
    // Only the buyer count is shown; the page does not need to wait on a ping.
    // `buyers` is keyed by phone — asking for `id` is a 400 on every visit.
    supabase
      .from('buyers')
      .select('phone', { count: 'exact', head: true })
      .then(({ count }) => {
        if (cancelled) return
        setBuyerCount(count)
        setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const exportBuyers = useCallback(async () => {
    if (!supabase) return

    // PRIVACY: `buyers` is keyed by phone number. A merchant may export only
    // the buyers who ordered from their own store; the whole-network export is
    // admin-only. Without a store selected a merchant would be exporting other
    // merchants' customers, so that is refused outright.
    const decision = canExportAudience({
      isAdmin: admin,
      hasStoreScope: Boolean(store),
      rowCount: 1, // refined below, once the row count is known
    })
    if (!admin && !store) {
      toast.push({ kind: 'error', title: 'Select a store first', detail: decision.reason })
      return
    }

    setExporting('buyers')
    try {
      // Own buyers only, resolved from this store's orders. No `select('*')`,
      // so `embedding` and `feature_vector` never leave the database.
      let phones: string[] = []
      let orderQuery = supabase.from('orders').select('buyer_phone')
      if (!admin) orderQuery = orderQuery.eq('store_id', store!.id)
      const { data: orderRows, error: orderErr } = await orderQuery
      if (orderErr) throw orderErr
      phones = [...new Set((orderRows ?? []).map((r) => r.buyer_phone).filter(Boolean) as string[])]

      if (phones.length === 0) {
        toast.push({ kind: 'error', title: 'Nothing to export', detail: 'This store has no buyers yet.' })
        return
      }

      const { data, error } = await supabase
        .from('buyers')
        .select('phone, risk_score, total_orders, total_accepted, total_refused, first_seen')
        .in('phone', phones.slice(0, 1000))
        .order('phone')
      if (error) throw error

      const buyers = (data ?? []) as AudienceBuyer[]
      const finalDecision = canExportAudience({ isAdmin: admin, hasStoreScope: Boolean(store), rowCount: buyers.length })
      const out = exportAudienceCsv(buyers, finalDecision)
      if (!out.ok) {
        toast.push({ kind: 'error', title: 'Export refused', detail: out.reason })
        return
      }

      download(`verafo-buyers-${new Date().toISOString().slice(0, 10)}.csv`, out.csv)
      toast.push({
        kind: 'success',
        title: 'Buyers exported',
        detail: `${buyers.length} ${admin ? 'rows' : 'of your own buyers'} downloaded.`,
      })
    } catch (err) {
      toast.push({ kind: 'error', title: 'Export failed', detail: err instanceof Error ? err.message : String(err) })
    } finally {
      setExporting(null)
    }
  }, [toast, admin, store])

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

  /**
   * What the merchant must type to confirm. Their store name is the most
   * meaningful thing to get right; if they have no store (network admin), the
   * account email stands in.
   */
  const confirmWord = store?.name?.trim() || user?.email || ''

  const deleteAccount = useCallback(async () => {
    if (!supabase) return
    setDeleting(true)
    try {
      const { error } = await supabase.rpc('delete_my_account')
      if (error) throw error
      toast.push({
        kind: 'success',
        title: 'Account deleted',
        detail: 'Your stores and data were removed. Buyer risk history was kept.',
      })
      // The auth user no longer exists, so the session is already invalid.
      await supabase.auth.signOut().catch(() => undefined)
      navigate(LOGIN_PATH, { replace: true })
    } catch (err) {
      setDeleting(false)
      toast.push({
        kind: 'error',
        title: 'Could not delete the account',
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }, [navigate, toast])

  const saveName = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    const trimmed = name.trim().slice(0, 40)
    setSavingName(true)
    const { error } = await supabase.auth.updateUser({ data: { name: trimmed } })
    setSavingName(false)
    if (error) {
      toast.push({ kind: 'error', title: 'Could not save name', detail: error.message })
      return
    }
    setName(trimmed)
    toast.push({
      kind: 'success',
      title: 'Saved',
      detail: trimmed ? `Greeting will use "${trimmed.split(/\s+/)[0]}".` : 'Greeting is back to impersonal.',
    })
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setPasswordError(null)
    if (newPassword.length < 8) {
      setPasswordError('Use at least 8 characters.')
      return
    }
    if (newPassword === currentPassword) {
      setPasswordError('Choose a password you have not used here before.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match.")
      return
    }
    setSavingPassword(true)

    // Prove the person at the keyboard knows the current password before we
    // change it — a borrowed session should not be able to take over an account.
    const email = user?.email
    if (!email) {
      setSavingPassword(false)
      setPasswordError('You are not signed in. Reload the page and try again.')
      return
    }
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    })
    if (verifyError) {
      setSavingPassword(false)
      setPasswordError(
        /invalid login credentials/i.test(verifyError.message)
          ? 'That current password is not right. If you signed up with Google, use "Forgot password?" on the sign-in screen instead.'
          : verifyError.message,
      )
      return
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)
    if (error) {
      setPasswordError(error.message)
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    toast.push({
      kind: 'success',
      title: 'Password changed',
      detail: 'Use the new password the next time you sign in.',
    })
  }

  if (!isConfigured || !supabase) return <NeedsSetup />

  // Hold the page until the buyer count lands, so the export buttons do not
  // flash an empty number and then change.
  if (!ready) {
    return (
      <div>
        <PageHeader
          title="Settings"
          description="Appearance, account and data."
        />
        <div className="settings-layout">
          <section className="card settings-section">
            <CardState loading skeletonHeight={280}>{null}</CardState>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Appearance, account and data."
      />

      <div className="settings-layout">
        <section className="card settings-section">
          <div className="settings-section-head">
            <span className="kpi-icon blue">
              <Icon name="person" size={16} />
            </span>
            <span className="eyebrow">Personal information</span>
          </div>
          <div className="settings-rows">
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Your name</div>
                <div className="setting-desc">Used for the personalised greeting on the dashboard.</div>
              </div>
              <form className="setting-control" onSubmit={(e) => void saveName(e)}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ali"
                  maxLength={40}
                  aria-label="Your name"
                />
                <button className="btn btn-ghost btn-sm" type="submit" disabled={savingName}>
                  {savingName ? <Icon name="refresh" size={14} className="spin" /> : 'Save'}
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="card settings-section">
          <div className="settings-section-head">
            <span className="kpi-icon blue">
              <Icon name="card" size={16} />
            </span>
            <span className="eyebrow">Plan and credits</span>
          </div>
          <div className="settings-rows">
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">{credits?.planName ?? 'Free'} plan</div>
                <div className="setting-desc">
                  A buyer check costs one credit. A call costs two credits, whatever its length.
                </div>
              </div>
              <div className="setting-control">
                <a
                  className="btn btn-ghost btn-sm"
                  href="https://admin.shopify.com/apps/ec17a432659bf1af629483bf28a50a25/app/billing"
                  target="_blank"
                  rel="noreferrer"
                >
                  Change plan
                </a>
              </div>
            </div>
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">This month</div>
                <div className="setting-desc">
                  {credits
                    ? credits.unlimited
                      ? `${Math.round(credits.used).toLocaleString()} checks used · your plan has no check limit`
                      : `${Math.round(credits.used).toLocaleString()} of ${credits.included.toLocaleString()} packaged credits used${
                          credits.cycleEnd
                            ? ` · resets ${new Date(credits.cycleEnd).toLocaleDateString(undefined, {
                                day: 'numeric',
                                month: 'short',
                              })}`
                            : ''
                        }${
                          credits.overageRate > 0 ? ` · then PKR ${credits.overageRate} a check` : ''
                        }`
                    : 'Reading your usage…'}
                </div>
              </div>
              <div className="setting-control">
                {credits?.unlimited ? (
                  <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--v-ink-400)]">
                    Unlimited
                  </span>
                ) : (
                  <div
                    className="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--v-ink-700)]"
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full rounded-full bg-[var(--cyan-primary)]"
                      style={{
                        width: `${
                          credits && credits.included > 0
                            ? Math.min(100, (credits.used / credits.included) * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            {credits && credits.overage > 0 && (
              <div className="setting-row">
                <div className="setting-info">
                  <div className="setting-title">Over the package</div>
                  <div className="setting-desc">
                    {Math.round(credits.overage).toLocaleString()} checks at PKR{' '}
                    {credits.overageRate} each = PKR{' '}
                    {overagePkr(credits).toLocaleString()} so far, billed on the next Shopify
                    invoice. There is no cap: each extra check is charged at the plan rate.
                  </div>
                </div>
              </div>
            )}
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Calls</div>
                <div className="setting-desc">
                  {credits
                    ? `${Math.round(credits.usedCalls).toLocaleString()} of ${credits.includedCalls.toLocaleString()} calls used${
                        credits.callsOneTime
                          ? ' · the free ten never reset'
                          : credits.cycleEnd
                            ? ` · resets ${new Date(credits.cycleEnd).toLocaleDateString(undefined, {
                                day: 'numeric',
                                month: 'short',
                              })}`
                            : ''
                      }${
                        credits.overageRatePerCall > 0
                          ? ` · then PKR ${credits.overageRatePerCall} a call`
                          : ''
                      }`
                    : 'Reading your usage…'}
                </div>
              </div>
              <div className="setting-control">
                <div
                  className="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--v-ink-700)]"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-[var(--cyan-primary)]"
                    style={{
                      width: `${
                        credits && credits.includedCalls > 0
                          ? Math.min(100, (credits.usedCalls / credits.includedCalls) * 100)
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>
            {credits && credits.overageCalls > 0 && (
              <div className="setting-row">
                <div className="setting-info">
                  <div className="setting-title">Calls over the package</div>
                  <div className="setting-desc">
                    {Math.round(credits.overageCalls).toLocaleString()} extra calls at PKR{' '}
                    {credits.overageRatePerCall} each = PKR{' '}
                    {overageCallPkr(credits).toLocaleString()} so far, billed on the next Shopify
                    invoice.
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
        <section className="card settings-section">
          <div className="settings-section-head">
            <span className="kpi-icon blue">
              <Icon name="shield-checkmark" size={16} />
            </span>
            <span className="eyebrow">Security</span>
          </div>
          <div className="settings-rows">
            <div className="setting-row" style={{ alignItems: 'flex-start' }}>
              <div className="setting-info">
                <div className="setting-title">Password</div>
                <div className="setting-desc">
                  Change the password you sign in with. We ask for the current one first.
                </div>
              </div>
              <form
                className="setting-control"
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, maxWidth: 260 }}
                onSubmit={(e) => void changePassword(e)}
              >
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value)
                    setPasswordError(null)
                  }}
                  placeholder="Current password"
                  aria-label="Current password"
                  autoComplete="current-password"
                  required
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value)
                    setPasswordError(null)
                  }}
                  placeholder="New password (8+ characters)"
                  aria-label="New password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    setPasswordError(null)
                  }}
                  placeholder="Confirm new password"
                  aria-label="Confirm new password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                {passwordError && <span className="field-error">{passwordError}</span>}
                <button className="btn btn-ghost btn-sm" type="submit" disabled={savingPassword}>
                  {savingPassword ? (
                    <Icon name="refresh" size={14} className="spin" />
                  ) : (
                    'Change password'
                  )}
                </button>
              </form>
            </div>
          </div>
        </section>

        <section className="card settings-section">
          <div className="settings-section-head">
            <span className="kpi-icon blue">
              <Icon name="sparkles" size={16} />
            </span>
            <span className="eyebrow">Calling</span>
          </div>
          <div className="settings-rows">
            {!calls && !callsLoading ? (
              <div className="setting-row">
                <div className="setting-info">
                  <div className="setting-title">Not set up yet</div>
                  <div className="setting-desc">
                    Open Verafo on your phone once for this store and calling settings appear here.
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="setting-row">
                  <div className="setting-info">
                    <div className="setting-title">Automate calls</div>
                    <div className="setting-desc">
                      Verafo calls every order at or above the threshold, one at a time, and records
                      what the buyer says. Orders below it are accepted without a call.
                    </div>
                  </div>
                  <button
                    className={`switch${calls?.auto_call ? ' on' : ''}`}
                    role="switch"
                    aria-checked={Boolean(calls?.auto_call)}
                    aria-label="Automate calls"
                    disabled={!calls || savingCalls === 'auto'}
                    onClick={() => void saveCalls({ auto_call: !calls?.auto_call }, 'auto')}
                  />
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <div className="setting-title">Call at this risk or higher</div>
                    <div className="setting-desc">
                      The line between calling and accepting silently. Applies to automation and to
                      the “Automate calls” switch on Outcomes.
                    </div>
                  </div>
                  <div className="seg" role="group" aria-label="Call risk threshold">
                    {CALL_THRESHOLDS.map((t) => (
                      <button
                        key={t}
                        className={
                          calls && Math.abs(calls.risk_threshold - t) < 0.001 ? 'active' : undefined
                        }
                        disabled={!calls || savingCalls === 'threshold'}
                        onClick={() => void saveCalls({ risk_threshold: t }, 'threshold')}
                        aria-pressed={Boolean(calls && Math.abs(calls.risk_threshold - t) < 0.001)}
                      >
                        {thresholdLabel(t)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setting-row">
                  <div className="setting-info">
                    <div className="setting-title">Credits left</div>
                    <div className="setting-desc">
                      A buyer check is one credit and a call is two, whatever its length. Checks and
                      calls each have their own allowance: Standard packs 1,500 checks a month then
                      bills PKR 2 a check, and Founder One has no check limit at all. Calls are{' '}
                      {credits?.includedCalls ?? 100} a month — the free plan's ten never reset — then
                      PKR 40 a call on Standard or PKR 30 on Founder One.
                    </div>
                  </div>
                  <div className="setting-control">
                    <span className="text-[15px] font-semibold tabular-nums text-foreground">
                      {credits
                        ? credits.unlimited
                          ? `${Math.round(credits.used).toLocaleString()} checks · unlimited`
                          : `${Math.round(credits.remaining).toLocaleString()} credits`
                        : '—'}
                      {' · '}
                      {credits ? Math.round(credits.remainingCalls).toLocaleString() : '—'} calls
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="card settings-section">
          <div className="settings-section-head">
            <span className="kpi-icon amber">
              <Icon name="sunny" size={16} />
            </span>
            <span className="eyebrow">Appearance</span>
          </div>
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

        {admin && (
          <section className="card settings-section">
            <div className="settings-section-head">
              <span className="kpi-icon safe">
                <Icon name="cloud-upload" size={16} />
              </span>
              <span className="eyebrow">Data</span>
            </div>
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
            </div>
          </section>
        )}

        {admin && (
          <section className="card settings-section">
            <div className="settings-section-head">
              <span className="kpi-icon safe">
                <Icon name="cloud-upload" size={16} />
              </span>
              <span className="eyebrow">Data</span>
            </div>
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
            </div>
          </section>
        )}

        <section className="card settings-section">
          <button
            type="button"
            className="settings-toggle"
            aria-expanded={importOpen}
            aria-controls="import-orders"
            onClick={() => setImportOpen((v) => !v)}
          >
            <span className="kpi-icon safe">
              <Icon name="cloud-upload" size={16} />
            </span>
            <span className="eyebrow">Import orders</span>
            <Icon name="chevron-down" size={16} className="toggle-chevron" />
          </button>

          {importOpen && (
            <div id="import-orders" className="settings-panel">
              <p className="setting-desc" style={{ marginBottom: 'var(--s-4)' }}>
                Bring order history in from another platform — an Instagram or WhatsApp order sheet,
                Daraz, WooCommerce, or an older Verafo export. Re-importing is safe, and rows that
                already arrived from Shopify are skipped. Courier delivery reports stay on the
                Courier reports page, because they are what sets outcomes.
              </p>
              <OrderImport />
            </div>
          )}
        </section>

        <section className="card settings-section">
          <button
            type="button"
            className="settings-toggle"
            aria-expanded={dangerOpen}
            aria-controls="danger-zone"
            onClick={() => setDangerOpen((v) => !v)}
          >
            <span className="kpi-icon amber">
              <Icon name="warning" size={16} />
            </span>
            <span className="eyebrow eyebrow-danger">Danger zone</span>
            <Icon name="chevron-down" size={16} className="toggle-chevron" />
          </button>

          {dangerOpen && (
            <div id="danger-zone" className="settings-rows settings-panel">
              <div className="setting-row">
                <div className="setting-info">
                  <div className="setting-title">Clear lookup history</div>
                  <div className="setting-desc">
                    Remove your recent searches from the Buyer Lookup page. Only your own history
                    is cleared; buyers and their risk scores are untouched.
                  </div>
                </div>
                <button className="btn btn-refuse btn-sm" disabled={clearing} onClick={() => void clearLookups()}>
                  {clearing ? <Icon name="refresh-outline" size={14} className="spin" /> : <Icon name="trash-outline" size={14} />}
                  Clear history
                </button>
              </div>

              <div className="setting-row">
                <div className="setting-info">
                  <div className="setting-title">Delete account</div>
                  <div className="setting-desc">
                    Permanently removes your stores, orders and outcomes, courier and call
                    settings, Shopify sync state, lookup history, chats and notifications. Buyer
                    risk history stays in Verafo, because it protects every other store too.
                    This cannot be undone.
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={confirmName}
                      onChange={(e) => setConfirmName(e.target.value)}
                      placeholder={`Type ${confirmWord} to confirm`}
                      aria-label={`Type ${confirmWord} to confirm account deletion`}
                      className="h-9 w-64 rounded-[10px] border border-border bg-card px-3 text-[13px]"
                      autoComplete="off"
                    />
                    <button
                      className="btn btn-refuse btn-sm"
                      disabled={deleting || !confirmWord || confirmName.trim().toLowerCase() !== confirmWord.trim().toLowerCase()}
                      onClick={() => void deleteAccount()}
                    >
                      {deleting ? <Icon name="refresh-outline" size={14} className="spin" /> : <Icon name="trash-outline" size={14} />}
                      Delete account
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
