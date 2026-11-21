import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { StatStrip } from '../components/app/stat-strip'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '../components/primitives/Skeleton'
import { EmptyState, NeedsSetup } from '../components/States'
import { useIsAdmin } from '../lib/admin'
import { money } from '../lib/format'
import { isConfigured } from '../lib/supabase'
import { useToast } from '../lib/toast'
import {
  changePlan,
  grantAllowance,
  readBillingRows,
  readPlanOptions,
  setPackage,
  setPlanState,
  type BillingRow,
  type PlanOption,
} from '../lib/billing-admin'

const FIELD =
  'h-11 w-full rounded-[10px] border border-border bg-card px-3 text-[13px] text-foreground outline-none transition-colors focus:border-[var(--cyan-primary)] md:h-9'

const BTN =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted md:h-9'

/** "1,500" / "Unlimited" — what this store's plan packs. */
function checkPackage(row: BillingRow): string {
  if (row.unlimited_checks) return 'Unlimited'
  return Number(row.included_credits).toLocaleString('en-PK')
}

function callPackage(row: BillingRow): string {
  const n = Number(row.included_calls).toLocaleString('en-PK')
  return row.plan_code === 'free' ? `${n} one time` : n
}

function usagePct(used: number, included: number): number {
  if (included <= 0) return 0
  return Math.min(1, used / included)
}

export function Billing() {
  const toast = useToast()
  const { admin, checking } = useIsAdmin()
  const [rows, setRows] = useState<BillingRow[]>([])
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<BillingRow | null>(null)
  const [checks, setChecks] = useState('0')
  const [calls, setCalls] = useState('0')
  const [note, setNote] = useState('')
  const [packageSize, setPackageSize] = useState('0')

  const load = useCallback(async () => {
    if (!supabaseReady()) return
    try {
      const [nextRows, nextPlans] = await Promise.all([readBillingRows(), readPlanOptions()])
      setRows(nextRows)
      setPlans(nextPlans)
    } catch (error) {
      toast.push({
        kind: 'error',
        title: 'Could not load billing',
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const totals = useMemo(() => {
    const paying = rows.filter((r) => r.plan_code !== 'free' && !r.suspended)
    return {
      paying: paying.length,
      mrr: paying.reduce((sum, r) => sum + r.price_pkr, 0),
      checks: rows.reduce((sum, r) => sum + Math.max(0, r.used_credits), 0),
      calls: rows.reduce((sum, r) => sum + Math.max(0, r.used_calls), 0),
      owed: rows.reduce((sum, r) => sum + r.owed_pkr, 0),
    }
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.store_name.toLowerCase().includes(q) ||
        (r.shopify_domain ?? '').toLowerCase().includes(q) ||
        (r.owner_email ?? '').toLowerCase().includes(q) ||
        r.plan_code.toLowerCase().includes(q),
    )
  }, [rows, query])

  function openEditor(row: BillingRow) {
    setEditing(row)
    setChecks('0')
    setCalls('0')
    setNote('')
    setPackageSize(String(row.included_override || ''))
  }

  async function run(key: string, work: () => Promise<void>, title: string) {
    setBusy(key)
    try {
      await work()
      await load()
      toast.push({ kind: 'success', title })
    } catch (error) {
      toast.push({
        kind: 'error',
        title: 'That did not save',
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  async function applyGrant(row: BillingRow, grantChecks: number, grantCalls: number, reason: string) {
    if (grantChecks === 0 && grantCalls === 0) return
    await run(
      `grant-${row.store_id}`,
      () => grantAllowance(row.store_id, grantChecks, grantCalls, reason),
      'Allowance updated',
    )
  }

  if (!isConfigured) return <NeedsSetup />

  return (
    <PageShell>
      <PageHeader
        title="Billing"
        description="Every merchant's plan, check credits and calls. Change a plan, top up an allowance, or suspend an account."
        actions={
          <button
            type="button"
            className={BTN}
            onClick={() => void load()}
          >
            <Icon name="refresh" size={16} className={loading ? 'spin' : ''} /> Refresh
          </button>
        }
      />

      {checking ? (
        <Card className="gap-0 p-6">
          <Skeleton height={16} />
          <Skeleton height={16} />
        </Card>
      ) : !admin ? (
        <Card className="gap-0 p-6">
          <EmptyState
            icon="shield-checkmark"
            title="Restricted to admins"
            detail="Only administrators can see and change billing. Head back to the dashboard to continue."
          />
          <div className="store-restricted-cta">
            <Link
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              to="/dashboard"
            >
              <Icon name="arrow-forward" size={14} /> Back to dashboard
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <StatStrip
            loading={loading && rows.length === 0}
            items={[
              {
                label: 'Paying stores',
                value: totals.paying,
                hint: `${money(totals.mrr)} a month in subscriptions`,
              },
              { label: 'Check credits used', value: Math.round(totals.checks), hint: 'This cycle, across all stores' },
              { label: 'Calls used', value: totals.calls, hint: 'This cycle, across all stores' },
              { label: 'Owed on top', value: money(totals.owed), hint: 'Overage, billed on the next invoice' },
            ]}
          />

          <section className="chart-section">
            <div className="verdict-panel-head">
              <h3 className="card-title">Stores</h3>
              <span className="verdict-conf">
                {rows.length} {rows.length === 1 ? 'store' : 'stores'} · the allowance resets on the 1st
              </span>
            </div>

            <div className="store-search">
              <Icon name="search" size={16} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by store, domain, owner or plan…"
                aria-label="Search stores"
              />
            </div>

            <Card className="gap-0 overflow-hidden p-0">
              {loading ? (
                <div className="flex flex-col gap-3 p-5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} height={18} />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon="storefront"
                  title={rows.length === 0 ? 'No stores yet' : 'No matches'}
                  detail={
                    rows.length === 0
                      ? 'A store appears here as soon as it is connected.'
                      : 'Try a different store name, domain, owner or plan.'
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th>Plan</th>
                        <th>Check credits</th>
                        <th>Calls</th>
                        <th>Owed</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((row) => (
                        <tr key={row.store_id}>
                          <td>
                            <div className="flex min-w-0 flex-col gap-1">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate text-[13px] font-semibold text-foreground">
                                  {row.store_name}
                                </span>
                                {row.suspended ? (
                                  <span className="chip chip-risk shrink-0">Suspended</span>
                                ) : row.plan_code !== 'free' ? (
                                  <span className="chip chip-cyan shrink-0">Active</span>
                                ) : null}
                              </span>
                              <span className="truncate text-[12px] text-muted-foreground">
                                {row.shopify_domain ?? row.owner_email ?? 'no domain'}
                              </span>
                            </div>
                          </td>
                          <td>
                            <select
                              className="h-9 w-full min-w-[136px] rounded-[10px] border border-border bg-card px-2 text-[13px] text-foreground"
                              value={row.plan_code}
                              disabled={busy === `plan-${row.store_id}`}
                              aria-label={`Plan for ${row.store_name}`}
                              onChange={(e) =>
                                void run(
                                  `plan-${row.store_id}`,
                                  () => changePlan(row.store_id, e.target.value),
                                  'Plan changed',
                                )
                              }
                            >
                              {plans.map((p) => (
                                <option key={p.code} value={p.code}>
                                  {p.name}
                                  {p.price_pkr > 0 ? ` · ${money(p.price_pkr)}` : ''}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <AllowanceCell
                              used={row.used_credits}
                              included={checkPackage(row)}
                              pct={row.unlimited_checks ? 0 : usagePct(row.used_credits, row.included_credits)}
                              unlimited={row.unlimited_checks}
                            />
                          </td>
                          <td>
                            <AllowanceCell
                              used={row.used_calls}
                              included={callPackage(row)}
                              pct={usagePct(row.used_calls, row.included_calls)}
                            />
                          </td>
                          <td className="tabular-nums text-[13px]">
                            {row.owed_pkr > 0 ? (
                              <span className="font-semibold text-foreground">{money(row.owed_pkr)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-2">
                              <button type="button" className={BTN} onClick={() => openEditor(row)}>
                                <Icon name="pencil" size={14} /> Adjust
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                title={row.suspended ? 'Reactivate this store' : 'Suspend this store'}
                                disabled={busy === `state-${row.store_id}`}
                                onClick={() =>
                                  void run(
                                    `state-${row.store_id}`,
                                    () =>
                                      setPlanState(
                                        row.store_id,
                                        row.suspended ? 'active' : 'suspended',
                                        !row.suspended,
                                      ),
                                    row.suspended ? 'Store reactivated' : 'Store suspended',
                                  )
                                }
                              >
                                <Icon name={row.suspended ? 'checkmark-circle' : 'close-circle'} size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </section>

          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            A check spends one credit and a call spends two. Free stops at zero; Standard bills
            {' '}{money(plans.find((p) => p.code === 'standard')?.overage_pkr_per_credit ?? 2)} a check after its
            package and {money(plans.find((p) => p.code === 'standard')?.overage_pkr_per_call ?? 40)} a call after its
            calls. Founder One has no check limit and bills {money(plans.find((p) => p.code === 'founder')?.overage_pkr_per_call ?? 30)} a
            call. Allowance changes are written to the credit ledger, so nothing is lost or rewritten.
          </p>
        </>
      )}

      <Dialog
        open={editing != null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editing?.store_name}</DialogTitle>
            <DialogDescription>
              Give this store more allowance, take it back, or change the size of its package.
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-muted-foreground" htmlFor="grant-checks">
                    Check credits
                  </label>
                  <input
                    id="grant-checks"
                    className={FIELD}
                    inputMode="numeric"
                    value={checks}
                    onChange={(e) => setChecks(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-muted-foreground" htmlFor="grant-calls">
                    Calls
                  </label>
                  <input
                    id="grant-calls"
                    className={FIELD}
                    inputMode="numeric"
                    value={calls}
                    onChange={(e) => setCalls(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Positive numbers add allowance, negative numbers take it away. This store has used{' '}
                {Math.max(0, Math.round(editing.used_credits))} of {checkPackage(editing)} check credits and{' '}
                {Math.max(0, editing.used_calls)} of {callPackage(editing)} calls this cycle.
              </p>

              <div className="flex flex-col gap-1.5">
                <label className="text-[12px] font-semibold text-muted-foreground" htmlFor="grant-note">
                  Note
                </label>
                <input
                  id="grant-note"
                  className={FIELD}
                  placeholder="Why this changed (shows in the ledger)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--cta-bg)] px-3.5 text-[12.5px] font-semibold text-[var(--cta-fg)] transition-colors hover:bg-[var(--cta-bg-hover)] disabled:opacity-60"
                  disabled={busy != null}
                  onClick={() =>
                    void applyGrant(editing, Number(checks) || 0, Number(calls) || 0, note).then(() => {
                      setEditing(null)
                    })
                  }
                >
                  <Icon name="check" size={14} /> Apply change
                </button>
                <button
                  type="button"
                  className={BTN}
                  disabled={busy != null || (editing.used_credits === 0 && editing.used_calls === 0)}
                  onClick={() =>
                    void applyGrant(
                      editing,
                      Math.max(0, Math.round(editing.used_credits)),
                      Math.max(0, Math.round(editing.used_calls)),
                      'cycle reset by an admin',
                    ).then(() => setEditing(null))
                  }
                >
                  <Icon name="refresh" size={14} /> Reset this cycle
                </button>
              </div>

              <div className="border-t border-border pt-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-muted-foreground" htmlFor="package-size">
                    Package override (0 = the plan's own number)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="package-size"
                      className={FIELD}
                      inputMode="numeric"
                      value={packageSize}
                      onChange={(e) => setPackageSize(e.target.value)}
                    />
                    <button
                      type="button"
                      className={BTN}
                      disabled={busy != null}
                      onClick={() =>
                        void run(
                          `package-${editing.store_id}`,
                          () => setPackage(editing.store_id, Number(packageSize) || 0),
                          'Package updated',
                        )
                      }
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <button type="button" className={BTN} onClick={() => setEditing(null)}>
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}

function AllowanceCell({
  used,
  included,
  pct,
  unlimited,
}: {
  used: number
  included: string
  pct: number
  unlimited?: boolean
}) {
  // A grant is stored as a negative ledger entry (negative spend), so an admin
  // can push a store's allowance above the package. Show the spend, not a
  // confusing minus sign, and name the bonus instead.
  const spent = Math.max(0, Math.round(used))
  const bonus = Math.max(0, Math.round(-used))
  return (
    <div className="flex min-w-[128px] flex-col gap-1.5">
      <span className="text-[13px] tabular-nums text-foreground">
        {spent.toLocaleString('en-PK')}{' '}
        <span className="text-muted-foreground">of {included}</span>
      </span>
      {bonus > 0 ? (
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--cyan-primary)]">
          +{bonus.toLocaleString('en-PK')} bonus
        </span>
      ) : unlimited ? (
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">no limit</span>
      ) : (
        <span className="h-[3px] w-full overflow-hidden rounded-full bg-border">
          <span
            className="block h-full rounded-full bg-[var(--cyan-primary)]"
            style={{ width: `${Math.round(Math.max(0.02, pct) * 100)}%` }}
          />
        </span>
      )}
    </div>
  )
}

function supabaseReady(): boolean {
  return isConfigured
}
