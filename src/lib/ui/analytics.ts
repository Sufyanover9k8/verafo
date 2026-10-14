/* ============================================================
   ui/analytics.ts — every insight Verafo shows, computed in one
   place from data the app has already loaded.

   Rules this module never breaks:
   · No invented numbers. If a figure is unknown it is null.
   · A rate is only published with its sample size.
   · "Unknown outcome" is its own bucket — never counted as accepted,
     never counted as refused.
   · Nothing here calls the network or the database.
   ============================================================ */

export type Outcome = 'accepted' | 'refused' | 'pending'

export interface ScoredOrder {
  id: string
  city?: string | null
  product_name?: string | null
  product_category?: string | null
  price?: number | null
  quantity?: number | null
  ordered_at?: string | null
  outcome?: Outcome | null
}

/** The smallest group Verafo will quote a rate for. Below this it says so. */
export const MIN_SAMPLE = 10

export interface Rate {
  /** Resolved orders only (accepted + refused). */
  resolved: number
  accepted: number
  refused: number
  /** Still waiting, or with no outcome row at all. */
  unknown: number
  /** refused / resolved, 0–1. Null when nothing has resolved. */
  rate: number | null
  /** False when there are fewer than MIN_SAMPLE resolved orders. */
  confident: boolean
}

export function orderValue(o: ScoredOrder): number | null {
  if (o.price == null || Number.isNaN(Number(o.price))) return null
  return Number(o.price) * (o.quantity ?? 1)
}

/** Counts and a refusal rate for a group of orders. */
export function rateOf(orders: ScoredOrder[]): Rate {
  let accepted = 0
  let refused = 0
  let unknown = 0
  for (const o of orders) {
    if (o.outcome === 'accepted') accepted++
    else if (o.outcome === 'refused') refused++
    else unknown++ // pending or missing — deliberately not a refusal
  }
  const resolved = accepted + refused
  return {
    resolved,
    accepted,
    refused,
    unknown,
    rate: resolved > 0 ? refused / resolved : null,
    confident: resolved >= MIN_SAMPLE,
  }
}

/** Total order value of a group, or null when no order carries a price. */
export function valueOf(orders: ScoredOrder[]): number | null {
  let sum = 0
  let any = false
  for (const o of orders) {
    const v = orderValue(o)
    if (v == null) continue
    any = true
    sum += v
  }
  return any ? sum : null
}

function normaliseCity(raw: string | null | undefined): string | null {
  const c = (raw ?? '').trim()
  if (!c) return null
  // Title-case so "lahore", "LAHORE" and "Lahore " are one city.
  return c
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export interface NamedRate extends Rate {
  name: string
  /** Total orders in the group, including unresolved. */
  orders: number
  /** Order value, or null when no price is recorded. */
  value: number | null
}

function groupRates(
  orders: ScoredOrder[],
  keyOf: (o: ScoredOrder) => string | null,
  opts: { minResolved?: number; limit?: number } = {},
): NamedRate[] {
  const min = opts.minResolved ?? MIN_SAMPLE
  const buckets = new Map<string, ScoredOrder[]>()
  for (const o of orders) {
    const k = keyOf(o)
    if (!k) continue
    const list = buckets.get(k)
    if (list) list.push(o)
    else buckets.set(k, [o])
  }

  const rows: NamedRate[] = []
  for (const [name, list] of buckets) {
    const r = rateOf(list)
    // A rate with too small a sample is not published as a rate at all.
    if (r.resolved < min) continue
    rows.push({ name, orders: list.length, value: valueOf(list), ...r })
  }
  // Worst refusal rate first; ties broken by the bigger sample.
  rows.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0) || b.resolved - a.resolved)
  return opts.limit ? rows.slice(0, opts.limit) : rows
}

/** Cities ranked by refusal rate. Only cities with enough resolved orders. */
export function cityRefusalRates(orders: ScoredOrder[], limit = 8): NamedRate[] {
  return groupRates(orders, (o) => normaliseCity(o.city), { limit })
}

/** Products ranked by refusal rate, using the product name then category. */
export function productRefusalRates(orders: ScoredOrder[], limit = 8): NamedRate[] {
  return groupRates(
    orders,
    (o) => (o.product_name ?? '').trim() || (o.product_category ?? '').trim() || null,
    { limit },
  )
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export type DayRate = NamedRate

/** Weekdays ranked by refusal rate. Needs a real date on the order. */
export function weekdayRefusalRates(orders: ScoredOrder[], limit = 7): DayRate[] {
  return groupRates(
    orders,
    (o) => {
      if (!o.ordered_at) return null
      const d = new Date(o.ordered_at)
      if (Number.isNaN(d.getTime())) return null
      return DAY_NAMES[d.getDay()]
    },
    { limit },
  )
}

export interface DayChange {
  /** The period just finished. */
  current: Rate
  /** The period before it, same length. */
  previous: Rate
  /** current.rate − previous.rate, in percentage points of refusal. Null if either side has no rate. */
  deltaPoints: number | null
  /** True only when both periods have enough resolved orders to compare. */
  confident: boolean
  days: number
}

/**
 * Compare the refusal rate of the last N days with the N days before it.
 * Returns null when the orders do not carry usable dates.
 *
 * Days are bucketed by whole days back from `now`, not by millisecond
 * arithmetic, so an order placed this morning cannot fall outside the window.
 */
export function refusalTrend(orders: ScoredOrder[], days = 7, now = Date.now()): DayChange | null {
  const dayMs = 86_400_000
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)

  /** 0 = today, 1 = yesterday … negative or null when undated/in the future. */
  function dayIndex(o: ScoredOrder): number | null {
    if (!o.ordered_at) return null
    const t = new Date(o.ordered_at).getTime()
    if (Number.isNaN(t)) return null
    const startOfThatDay = new Date(t).setHours(0, 0, 0, 0)
    return Math.round((startOfToday - startOfThatDay) / dayMs)
  }

  const dated = orders.map((o) => ({ o, idx: dayIndex(o) })).filter((x) => x.idx != null)
  if (dated.length === 0) return null

  const current = dated.filter((x) => x.idx! >= 0 && x.idx! < days).map((x) => x.o)
  const previous = dated.filter((x) => x.idx! >= days && x.idx! < days * 2).map((x) => x.o)

  const c = rateOf(current)
  const p = rateOf(previous)
  const deltaPoints = c.rate != null && p.rate != null ? (c.rate - p.rate) * 100 : null

  return { current: c, previous: p, deltaPoints, confident: c.confident && p.confident, days }
}

/** One plain sentence for a change, or null when there is nothing honest to say. */
export function refusalTrendSentence(trend: DayChange | null): string | null {  if (!trend || trend.deltaPoints == null) return null
  if (!trend.confident) {
    return `Not enough resolved orders yet to compare the last ${trend.days} days with the ${trend.days} before.`
  }
  const before = Math.round((trend.previous.rate ?? 0) * 100)
  const after = Math.round((trend.current.rate ?? 0) * 100)
  if (Math.abs(trend.deltaPoints) < 1) {
    return `Refusal rate is steady at ${after}% over the last ${trend.days} days.`
  }
  const dir = trend.deltaPoints > 0 ? 'up' : 'down'
  return `Refusal rate is ${dir} to ${after}% from ${before}% the ${trend.days} days before.`
}

/* ── Display helpers for the insight cards ─────────────────── */

/** "34%" from 0.34. A dash when the rate is not known. */
export function formatRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 100)}%`
}

/** How many orders this insight group was built from. */
export function sampleLabel(g: NamedRate): string {
  return `${g.resolved} resolved of ${g.orders} order${g.orders === 1 ? '' : 's'}`
}

/**
 * Is there enough data to publish an insight at all?
 * Used to hide a whole card rather than show a rate on a tiny sample.
 */
export function hasEnoughForInsight(rows: NamedRate[]): boolean {
  return rows.length > 0
}

/**
 * The one thing worth doing about a group with a high refusal rate.
 * Deliberately phrased as a suggestion, never as an instruction, and it
 * never claims Verafo prevented anything.
 */
export function actionForRate(g: NamedRate, what: 'city' | 'product' | 'weekday'): string {
  const rate = g.rate ?? 0
  const noun = what === 'city' ? 'this city' : what === 'product' ? 'this product' : 'this day'
  if (rate >= 0.5) {
    return `Refusals run high in ${noun}. Consider requiring a confirmation call before shipping here.`
  }
  if (rate >= 0.3) {
    return `Worth watching — confirm orders in ${noun} before dispatch.`
  }
  return `Refusals are low in ${noun}. No change needed.`
}

/* ── Money at risk ─────────────────────────────────────────── */

export interface MoneyAtRisk {
  /** Value of pending orders whose buyer looks MEDIUM or HIGH. */
  atRisk: number | null
  /** Value of orders with a recorded refusal. */
  refused: number | null
  /** Value of orders still awaiting a decision, whatever the buyer looks like. */
  undecided: number | null
  /** How many orders the figures were computed from. */
  basedOn: number
}

/**
 * Money figures for the dashboard. `toneOf` lets the caller decide which
 * buyers count as risky, using the app's existing risk rules.
 */
export function moneyAtRisk(
  orders: ScoredOrder[],
  toneOf: (o: ScoredOrder) => 'safe' | 'watch' | 'high' | 'unknown',
  buyerOf?: (o: ScoredOrder) => { total_orders?: number | null } | undefined,
): MoneyAtRisk {
  let atRisk = 0
  let atRiskAny = false
  let refused = 0
  let refusedAny = false
  let undecided = 0
  let undecidedAny = false

  for (const o of orders) {
    const v = orderValue(o)
    const isPending = o.outcome == null || o.outcome === 'pending'
    const buyer = buyerOf?.(o)
    const known = buyer ? (buyer.total_orders ?? 0) >= 1 : true

    if (isPending && v != null) {
      undecidedAny = true
      undecided += v
      const tone = toneOf(o)
      if (known && (tone === 'watch' || tone === 'high')) {
        atRiskAny = true
        atRisk += v
      }
    }
    if (o.outcome === 'refused' && v != null) {
      refusedAny = true
      refused += v
    }
  }

  return {
    atRisk: atRiskAny ? atRisk : null,
    refused: refusedAny ? refused : null,
    undecided: undecidedAny ? undecided : null,
    basedOn: orders.length,
  }
}

/* ── Buyer segments (lookalike audiences) ──────────────────── */

export interface SegmentBuyer {
  phone: string
  risk_score?: number | null
  total_orders?: number | null
  total_accepted?: number | null
  total_refused?: number | null
  spend?: number | null
}

export interface Segment {
  key: string
  title: string
  /** One plain sentence explaining who is in it. */
  detail: string
  buyers: SegmentBuyer[]
}

function refusalRate(b: SegmentBuyer): number | null {
  const resolved = (b.total_accepted ?? 0) + (b.total_refused ?? 0)
  if (resolved <= 0) return null
  return (b.total_refused ?? 0) / resolved
}

/**
 * Data-driven buyer groups. Every group is a rule over fields the app
 * already has, and a buyer can appear in more than one group.
 * Similarity or a clean record is never presented as proof of trust.
 */
export function buyerSegments(buyers: SegmentBuyer[]): Segment[] {
  const scored = buyers.filter((b) => (b.total_orders ?? 0) >= 1)

  const repeat = scored
    .filter((b) => (b.total_orders ?? 0) >= 3 && (refusalRate(b) ?? 1) <= 0.2)
    .sort((a, b) => (b.total_orders ?? 0) - (a.total_orders ?? 0))

  const highValueLowRisk = scored
    .filter((b) => (refusalRate(b) ?? 1) === 0 && (b.risk_score ?? 1) < 0.45 && (b.spend ?? 0) > 0)
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))

  const needsConfirm = scored
    .filter((b) => (b.risk_score ?? 0) >= 0.45)
    .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0))

  const thinHistory = buyers
    .filter((b) => (b.total_orders ?? 0) < 3)
    .sort((a, b) => (a.total_orders ?? 0) - (b.total_orders ?? 0))

  const all: Segment[] = [
    {
      key: 'repeat',
      title: 'Best repeat buyers',
      detail: 'Three or more resolved orders with a refusal rate of 20% or less.',
      buyers: repeat,
    },
    {
      key: 'valuable',
      title: 'High-value, never refused',
      detail: 'Buyers with spend recorded and no refusal in their history.',
      buyers: highValueLowRisk,
    },
    {
      key: 'confirm',
      title: 'Confirm before shipping',
      detail: 'Buyers whose score is MEDIUM or HIGH. Worth a call, not a refusal.',
      buyers: needsConfirm,
    },
    {
      key: 'thin',
      title: 'Too little history to judge',
      detail: 'Fewer than three resolved orders. Not a risk signal on its own.',
      buyers: thinHistory,
    },
  ]

  return all.filter((s) => s.buyers.length > 0)
}

/**
 * A short plain-text summary a merchant can paste into a chat.
 * Only states what the data supports.
 */
export function buyerSummary(input: {
  phone: string
  verdictWord: string
  riskScore?: number | null
  totalOrders?: number | null
  accepted?: number | null
  refused?: number | null
  stores?: number | null
}): string {
  const parts: string[] = [`Buyer ${input.phone}`]
  parts.push(`Verdict: ${input.verdictWord}`)
  if (input.riskScore != null) parts.push(`Risk score ${Number(input.riskScore).toFixed(2)} of 1`)
  if (input.totalOrders != null) parts.push(`${input.totalOrders} order${input.totalOrders === 1 ? '' : 's'} in the network`)
  if (input.accepted != null || input.refused != null) {
    parts.push(`${input.accepted ?? 0} accepted, ${input.refused ?? 0} refused`)
  }
  if (input.stores != null && input.stores > 0) {
    parts.push(`Seen at ${input.stores} connected store${input.stores === 1 ? '' : 's'}`)
  }
  parts.push('Checked with Verafo.')
  return parts.join('. ').replace(/\.\./g, '.')
}
