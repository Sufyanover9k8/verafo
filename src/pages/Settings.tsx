import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  Building2,
  CloudUpload,
  Database,
  Download,
  Loader2,
  LogOut,
  Palette,
  Server,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CardState } from '../components/app/card-state'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Reveal } from '../components/Reveal'
import { canExportAudience, exportAudienceCsv, type AudienceBuyer } from '../lib/ui/audiences'
import { NeedsSetup } from '../components/States'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useIsAdmin } from '../lib/admin'
import { useStoreScope } from '../lib/store'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { useSession } from '../lib/session'
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

/** One titled block. Every settings section has the same shape. */
function Section({
  icon: Icon,
  eyebrow,
  children,
}: {
  icon: LucideIcon
  eyebrow: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-[16px] border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-muted text-primary-text">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <span className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">{eyebrow}</span>
      </div>
      {children}
    </section>
  )
}

/** A label/description on the left, its control on the right. */
function Row({ title, desc, control }: { title: string; desc: string; control: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-[15rem] flex-1">
        <p className="text-[14px] font-semibold text-foreground">{title}</p>
        <p className="mt-0.5 max-w-prose text-[12.5px] text-muted-foreground">{desc}</p>
      </div>
      {control}
    </div>
  )
}

function Tile({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-[10px] border border-border bg-muted/40 px-3 py-2.5">
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-[14px] font-medium text-foreground', mono && 'font-mono tabular-nums')}>{value}</p>
    </div>
  )
}

export function Settings() {
  const toast = useToast()
  const { admin } = useIsAdmin()
  const { store } = useStoreScope()
  const { displayName } = useSession()
  const { theme, reducedMotion, resolved, setTheme, setReducedMotion } = useTheme()
  const [exporting, setExporting] = useState<'buyers' | 'orders' | null>(null)
  const [clearing, setClearing] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [conn, setConn] = useState<'checking' | 'ok' | 'fail'>('checking')
  const [buyerCount, setBuyerCount] = useState<number | null>(null)
  const [orderCount, setOrderCount] = useState<number | null>(null)
  const [name, setName] = useState<string>(displayName)
  const [savingName, setSavingName] = useState(false)

  useEffect(() => {
    setName(displayName)
  }, [displayName])

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
      setConfirmClear(false)
    }
  }, [toast])

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

  if (!isConfigured || !supabase) return <NeedsSetup />

  // While the connection check is still running, show a skeleton instead of
  // half-filled numbers. The real sections replace it once it settles.
  if (conn === 'checking') {
    return (
      <PageShell>
        <PageHeader title="Settings" description="Appearance, data and connection — everything in one place." />
        <div className="rounded-[16px] border border-border bg-card p-6">
          <CardState loading skeletonHeight={280}>{null}</CardState>
        </div>
      </PageShell>
    )
  }

  const edgeHost = functionsBaseUrl() ? new URL(functionsBaseUrl()!).host : null

  return (
    <PageShell>
      <PageHeader title="Settings" description="Appearance, data and connection — everything in one place." />

      <Reveal stagger className="flex flex-col gap-6">
        <Section icon={User} eyebrow="Personal information">
          <Row
            title="Your name"
            desc="Used for the personalised greeting on the dashboard."
            control={
              <form className="flex items-center gap-2" onSubmit={(e) => void saveName(e)}>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ali"
                  maxLength={40}
                  aria-label="Your name"
                  className="h-11 w-full min-w-[10rem] rounded-[10px] border border-input bg-card px-3 text-[15px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)] md:h-9"
                />
                <Button type="submit" variant="outline" size="sm" className="h-11 gap-1.5 px-3 md:h-9" disabled={savingName}>
                  {savingName ? <Loader2 className="size-3.5 animate-spin" /> : 'Save'}
                </Button>
              </form>
            }
          />
        </Section>

        <Section icon={Palette} eyebrow="Appearance">
          <Row
            title="Theme"
            desc="Choose how Verafo looks. System follows your device."
            control={
              <div
                role="group"
                aria-label="Theme"
                className="inline-flex items-center rounded-[10px] border border-border bg-muted/60 p-0.5"
              >
                {(['dark', 'light', 'system'] as Theme[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={theme === t}
                    title={t === 'system' ? `Resolved: ${resolved}` : undefined}
                    onClick={() => setTheme(t)}
                    className={cn(
                      'h-11 rounded-[10px] px-3 text-[13px] font-medium transition-colors md:h-8',
                      theme === t
                        ? 'bg-card text-foreground shadow-1 ring-1 ring-border'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            }
          />

          <Row
            title="Reduced motion"
            desc="Disable animations and transitions."
            control={
              <Switch
                checked={reducedMotion}
                onCheckedChange={setReducedMotion}
                aria-label="Reduced motion"
              />
            }
          />
        </Section>

        <Section icon={Trash2} eyebrow="Activity">
          <Row
            title="Clear your lookup history"
            desc="Remove your recent searches from the Buyer Lookup page. This only clears your own history — it doesn't affect other people on your team."
            control={
              <Button
                variant="outline"
                size="sm"
                className="h-11 gap-1.5 border-risk-high/40 px-3 text-risk-high-strong hover:bg-risk-high-soft md:h-9"
                disabled={clearing}
                onClick={() => setConfirmClear(true)}
              >
                {clearing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Clear history
              </Button>
            }
          />
        </Section>

        {admin && (
          <Section icon={Database} eyebrow="Data">
            <Row
              title="Export buyers"
              desc={`Download all ${buyerCount ?? '…'} buyer profiles as a CSV.`}
              control={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 gap-1.5 px-3 md:h-9"
                  disabled={exporting !== null}
                  onClick={() => void exportBuyers()}
                >
                  {exporting === 'buyers' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  Export CSV
                </Button>
              }
            />
            <Row
              title="Export orders"
              desc="Download up to 2000 orders (with store and outcome) as a CSV."
              control={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 gap-1.5 px-3 md:h-9"
                  disabled={exporting !== null}
                  onClick={() => void exportOrders()}
                >
                  {exporting === 'orders' ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  Export CSV
                </Button>
              }
            />
          </Section>
        )}

        <Section icon={Server} eyebrow="Connection">
          <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-muted/40 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-card text-primary-text">
              <CloudUpload className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-foreground">
                Supabase {conn === 'ok' ? 'connected' : 'unreachable'}
              </p>
              <p className="truncate font-mono text-[12px] text-muted-foreground">{edgeHost ?? 'not configured'}</p>
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium',
                conn === 'ok'
                  ? 'border-risk-safe/40 bg-risk-safe-soft text-risk-safe-strong'
                  : 'border-risk-watch/40 bg-risk-watch-soft text-risk-watch-strong',
              )}
            >
              <span className={cn('size-1.5 rounded-full', conn === 'ok' ? 'bg-risk-safe' : 'bg-risk-watch')} />
              {conn === 'ok' ? 'online' : 'offline'}
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Tile label="Buyers" value={buyerCount ?? '…'} mono />
            <Tile label="Orders" value={orderCount ?? '…'} mono />
            <Tile label="Edge functions" value={functionsBaseUrl() ? 'Deployed' : 'Not deployed'} />
          </div>
        </Section>

        <Section icon={ShieldCheck} eyebrow="About">
          <div className="flex items-center gap-3">
            <img src="/verafo-logo.png" alt="" className="size-9 shrink-0 object-contain dark:brightness-0 dark:invert" />
            <div>
              <p className="text-[15px] font-semibold text-foreground">Verafo</p>
              <p className="text-[12.5px] text-muted-foreground">COD risk intelligence</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Tile label="Version" value="v0.2" mono />
            <Tile label="Backend" value="Supabase" />
            <Tile label="AI functions" value="OpenAI edge functions" />
          </div>
          {!functionsBaseUrl() && (
            <p className="mt-4 rounded-[10px] border border-risk-watch/40 bg-risk-watch-soft px-3 py-2.5 text-[12.5px] text-risk-watch-strong">
              Deploy the <code className="font-mono">verafo-ai</code> edge function to unlock chat, analysis and AI
              explanations.
            </p>
          )}
        </Section>

        <Section icon={Building2} eyebrow="Account">
          <Row
            title="Sign out"
            desc="Log out of your Verafo account on this device."
            control={
              <Button
                variant="outline"
                size="sm"
                className="h-11 gap-1.5 border-risk-high/40 px-3 text-risk-high-strong hover:bg-risk-high-soft md:h-9"
                onClick={() => setConfirmSignOut(true)}
              >
                <LogOut className="size-3.5" /> Sign out
              </Button>
            }
          />
        </Section>
      </Reveal>

      {/* Clearing history and signing out cannot be undone, so both ask first. */}
      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear your lookup history?</DialogTitle>
            <DialogDescription>
              Your recent searches on the Buyer Lookup page will be removed. This cannot be undone, and it does not
              affect anyone else on your team.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setConfirmClear(false)}>
              Cancel
            </Button>
            <Button variant="destructive" className="h-11" disabled={clearing} onClick={() => void clearLookups()}>
              {clearing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Clear history
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmSignOut} onOpenChange={setConfirmSignOut}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign out of Verafo?</DialogTitle>
            <DialogDescription>You will need to sign in again on this device.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11" onClick={() => setConfirmSignOut(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-11"
              onClick={() => {
                setConfirmSignOut(false)
                void supabase?.auth.signOut()
              }}
            >
              <LogOut className="size-4" /> Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
