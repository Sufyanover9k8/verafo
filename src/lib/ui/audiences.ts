/* ============================================================
   ui/audiences.ts — lookalike audiences and Buyer Passport
   helpers.

   THE PRIVACY RULE THIS FILE EXISTS TO ENFORCE
   The `buyers` table is keyed by phone number. Before the privacy
   migration, one blanket read policy let any signed-in merchant read
   every buyer row on the network, fingerprints included, and Settings
   offered a one-click CSV of all of them.

   So: a merchant may export their OWN buyers. Only an admin may export
   the network. `canExportAudience` is the single decision point, and
   the tests cover it, because an export is the highest-risk action in
   the whole product — it leaves our control permanently.

   Pure functions only: no network, no database.
   ============================================================ */

import { toCsv, type CsvRow } from './csv'
import { formatPhonePK } from './phone'

/** A buyer as the app is allowed to know them. */
export interface AudienceBuyer {
  phone: string
  risk_score?: number | null
  total_orders?: number | null
  total_accepted?: number | null
  total_refused?: number | null
  first_seen?: string | null
  /** Order value this merchant recorded for them, when known. */
  spend?: number | null
  /** True when this buyer has ordered from the merchant's own store. */
  isOwn?: boolean
}

export type SegmentKey = 'repeat' | 'valuable' | 'confirm' | 'thin' | 'lapsed'

export interface SegmentDef {
  key: SegmentKey
  title: string
  /** What the rule is, in plain words. */
  rule: string
  /** What the merchant should understand about it. */
  meaning: string
  /** True when the segment could be read as a risk judgement. */
  riskFramed: boolean
}

export const SEGMENTS: SegmentDef[] = [
  {
    key: 'repeat',
    title: 'Good repeat buyers',
    rule: '3 or more resolved orders, refusal rate 20% or less',
    meaning: 'These buyers keep accepting their parcels. Worth keeping happy.',
    riskFramed: false,
  },
  {
    key: 'valuable',
    title: 'High value, never refused',
    rule: 'Order value recorded, no refusal at all',
    meaning: 'They have never refused. Spend is what you recorded, not profit.',
    riskFramed: false,
  },
  {
    key: 'confirm',
    title: 'Confirm before shipping',
    rule: 'Risk score 0.45 or above',
    meaning: 'A higher risk score is a reason to confirm, not proof of anything.',
    riskFramed: true,
  },
  {
    key: 'thin',
    title: 'Too little history to judge',
    rule: 'Fewer than 3 resolved orders',
    meaning: 'Missing information. This is not a risk finding about the buyer.',
    riskFramed: false,
  },
  {
    key: 'lapsed',
    title: 'Quiet for 90 days or more',
    rule: 'No order in the last 90 days',
    meaning: 'They bought before but have gone quiet. A reason to reach out, not to avoid.',
    riskFramed: false,
  },
]

/** Resolved orders, or 0. */
function resolved(b: AudienceBuyer): number {
  return (b.total_accepted ?? 0) + (b.total_refused ?? 0)
}

/** refused / resolved, or null when nothing has resolved. */
export function refusalRateOf(b: AudienceBuyer): number | null {
  const r = resolved(b)
  if (r <= 0) return null
  return (b.total_refused ?? 0) / r
}

/** Days since the last order, or null when we cannot tell. */
export function daysSince(b: AudienceBuyer, now = Date.now()): number | null {
  if (!b.first_seen) return null
  const t = new Date(b.first_seen).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((now - t) / 86_400_000)
}

const LAPSED_DAYS = 90
const MIN_ORDERS_FOR_CONFIDENCE = 3

/**
 * Put buyers into segments. Each rule reads only fields the app already
 * has, and a buyer may appear in more than one segment.
 *
 * Buyers with a missing risk score are never placed in a risk-framed
 * segment — absence of a score is absence of information.
 */
export function buildSegments(
  buyers: AudienceBuyer[],
  now = Date.now(),
): Record<SegmentKey, AudienceBuyer[]> {
  const out: Record<SegmentKey, AudienceBuyer[]> = {
    repeat: [],
    valuable: [],
    confirm: [],
    thin: [],
    lapsed: [],
  }

  for (const b of buyers) {
    const orders = b.total_orders ?? 0
    const rate = refusalRateOf(b)

    if (orders >= MIN_ORDERS_FOR_CONFIDENCE && rate != null && rate <= 0.2) out.repeat.push(b)

    if (rate === 0 && (b.spend ?? 0) > 0) out.valuable.push(b)

    if (b.risk_score != null && Number.isFinite(Number(b.risk_score)) && Number(b.risk_score) >= 0.45) {
      out.confirm.push(b)
    }

    if (orders < MIN_ORDERS_FOR_CONFIDENCE) out.thin.push(b)

    const quiet = daysSince(b, now)
    if (quiet != null && quiet >= LAPSED_DAYS) out.lapsed.push(b)
  }

  out.repeat.sort((a, b) => (b.total_orders ?? 0) - (a.total_orders ?? 0))
  out.valuable.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
  out.confirm.sort((a, b) => Number(b.risk_score ?? 0) - Number(a.risk_score ?? 0))
  out.thin.sort((a, b) => (a.total_orders ?? 0) - (b.total_orders ?? 0))
  out.lapsed.sort((a, b) => (daysSince(b, now) ?? 0) - (daysSince(a, now) ?? 0))

  return out
}

/* ── Buyer Passport ────────────────────────────────────────── */

export interface Passport {
  /** From this merchant's own orders only. */
  own: {
    orders: number
    accepted: number
    refused: number
    /** Order value this merchant recorded, or null. */
    value: number | null
  }
  /** Aggregate counts from across the network. No identities. */
  network: {
    totalOrders: number
    totalAccepted: number
    totalRefused: number
    storeCount: number
    firstSeen: string | null
  } | null
  /** True when the buyer has no resolved history anywhere, so no score exists. */
  unknown: boolean
}

/**
 * Build a passport from the two sources, kept visibly apart.
 *
 * `own` is what this merchant can see in full. `network` is counts only —
 * never another merchant's name, order or contact details, because those
 * are not ours to hand over.
 */
export function buildPassport(params: {
  ownOrders: { outcome?: string | null; value?: number | null }[]
  network?: {
    total_orders?: number | null
    total_accepted?: number | null
    total_refused?: number | null
    store_count?: number | null
    first_seen?: string | null
  } | null
}): Passport {
  let accepted = 0
  let refused = 0
  let value: number | null = null

  for (const o of params.ownOrders) {
    if (o.outcome === 'accepted') accepted++
    else if (o.outcome === 'refused') refused++
    if (o.value != null) value = (value ?? 0) + o.value
  }

  const n = params.network
  const totalOrders = Number(n?.total_orders ?? 0) || 0
  const totalAccepted = Number(n?.total_accepted ?? 0) || 0
  const totalRefused = Number(n?.total_refused ?? 0) || 0
  const storeCount = Number(n?.store_count ?? 0) || 0

  return {
    own: { orders: params.ownOrders.length, accepted, refused, value },
    network: n
      ? {
          totalOrders,
          totalAccepted,
          totalRefused,
          storeCount,
          firstSeen: n.first_seen ?? null,
        }
      : null,
    unknown: totalAccepted + totalRefused === 0,
  }
}

/* ── Export authorization ──────────────────────────────────── */

export interface ExportDecision {
  allowed: boolean
  /** Why, in a sentence the UI can show. Empty when allowed. */
  reason: string
}

/**
 * May this user export an audience?
 *
 * The single decision point for the riskiest action in the product. An
 * export cannot be recalled, so a merchant may only take their own
 * buyers; the network export is admin-only.
 */
export function canExportAudience(params: {
  isAdmin: boolean
  /** false when no store is selected, which means "the whole network". */
  hasStoreScope: boolean
  rowCount: number
}): ExportDecision {
  if (params.isAdmin) {
    return params.rowCount > 0 ? { allowed: true, reason: '' } : { allowed: false, reason: 'Nothing to export.' }
  }
  if (!params.hasStoreScope) {
    return {
      allowed: false,
      reason:
        'Select a specific store before exporting. Without a store selected this would include buyers that are not yours.',
    }
  }
  if (params.rowCount === 0) return { allowed: false, reason: 'Nothing to export.' }
  return { allowed: true, reason: '' }
}

/** The columns a merchant is allowed to receive. */
export const AUDIENCE_EXPORT_COLUMNS = [
  'phone',
  'risk_score',
  'total_orders',
  'total_accepted',
  'total_refused',
  'first_seen',
  'spend',
] as const

/**
 * Build the CSV for an audience export.
 *
 * Refuses to produce anything when the caller is not authorized, so a UI
 * mistake cannot leak data. Phone numbers are written in the clean
 * international form when they can be trusted, and left as-is when they
 * cannot, so the file never invents a number.
 */
export function exportAudienceCsv(
  buyers: AudienceBuyer[],
  decision: ExportDecision,
): { ok: true; csv: string } | { ok: false; reason: string } {
  if (!decision.allowed) return { ok: false, reason: decision.reason }

  const rows: CsvRow[] = buyers.map((b) => {
    const parsed = formatPhonePK(b.phone)
    return {
      phone: parsed ? parsed.e164 : b.phone,
      risk_score: b.risk_score ?? '',
      total_orders: b.total_orders ?? '',
      total_accepted: b.total_accepted ?? '',
      total_refused: b.total_refused ?? '',
      first_seen: b.first_seen ? String(b.first_seen).slice(0, 10) : '',
      spend: b.spend ?? '',
    }
  })

  return { ok: true, csv: toCsv(rows, [...AUDIENCE_EXPORT_COLUMNS]) }
}
