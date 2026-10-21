/* ============================================================
   ui/order-csv.ts — reading an order file a merchant already has.

   The point of this module: a merchant should be able to download their
   orders from Shopify and upload that file untouched. So the parser accepts
   Shopify's own orders export exactly as Shopify writes it, and maps it onto
   the fields Verafo stores.

   Two shapes are understood:
     · Shopify export — one row PER LINE ITEM, so several rows share one
       order Name. Rows are merged by order before they become orders.
     · Verafo's own template — one row per order.

   Everything here is pure so it can be tested against a real export.
   ============================================================ */

import { normalizePhone } from '../format'

export type Outcome = 'accepted' | 'refused' | 'pending'

/** One order, after parsing — the unit the importer inserts. */
export interface ParsedOrder {
  /** Insertion order, so a failure can name the row a merchant can see. */
  line: number
  /** Order number from the file (#SC1010), when the file carries one. */
  reference: string
  phone: string
  store: string
  category: string
  product: string
  price: number | null
  quantity: number
  address: string
  city: string
  ordered_at: string | null
  outcome: Outcome | null
  resolved_at: string | null
  /** Shopify's customer email, when the file carries one. */
  email: string
  /** How many line items were folded into this order. */
  lineItems: number
}

export interface ParseResult {
  orders: ParsedOrder[]
  headers: string[]
  /** 'shopify' | 'verafo' | null when the header told us nothing. */
  format: 'shopify' | 'verafo' | null
  errors: string[]
  /** Rows that carried no phone number, counted rather than listed. */
  skipped: number
}

/**
 * Header → field aliases, keyed by `matchKey` (letters and digits only).
 *
 * The Shopify entries are the whole reason this module exists: its export
 * spreads the customer across Billing/Shipping pairs and puts the order
 * number in `Name`, which collides with nothing else here.
 */
const HEADER_ALIASES: Record<string, string> = {
  // ── Shopify orders export ────────────────────────────────
  // Deliberately NO mapping for Shopify's `Id` column: it holds the numeric
  // order id, and letting it resolve `reference` would shadow `Name` (the
  // order number a merchant actually recognises) and split multi-line orders
  // across two keys, since only one of the two rows repeats the id here.
  name: 'reference',
  email: 'email',
  createdat: 'ordered_at',
  lineitemquantity: 'quantity',
  lineitemname: 'product',
  lineitemprice: 'price',
  lineitemsku: 'sku',
  shippingphone: 'phone',
  billingphone: 'phone_alt',
  phone: 'phone',
  shippingcity: 'city',
  billingcity: 'city_alt',
  shippingaddress1: 'address',
  shippingstreet: 'address_alt',
  billingaddress1: 'address_alt2',
  billingstreet: 'address_alt3',
  shippingprovincename: 'region',
  shippingprovince: 'region_alt',
  billingprovincename: 'region_alt2',
  fulfilledat: 'fulfilled_at',
  cancelledat: 'cancelled_at',
  vendor: 'store',
  total: 'total',

  // ── Verafo's own template, and the aliases it always accepted ──
  buyer: 'phone',
  buyerphone: 'phone',
  mobileno: 'phone',
  number: 'phone',
  store: 'store',
  storename: 'store',
  category: 'category',
  productcategory: 'category',
  product: 'product',
  productname: 'product',
  item: 'product',
  price: 'price',
  amount: 'price',
  value: 'price',
  quantity: 'quantity',
  qty: 'quantity',
  address: 'address',
  city: 'city',
  orderedat: 'ordered_at',
  date: 'ordered_at',
  orderdate: 'ordered_at',
  outcome: 'outcome',
  status: 'outcome',
  result: 'outcome',
  resolvedat: 'resolved_at',
  reference: 'reference',
  ordernumber: 'reference',
  ordername: 'reference',
}

/**
 * The lookup key: letters and digits only.
 *
 * Shopify's headers are inconsistent about how they join words — `Shipping
 * Phone`, `Created at`, `Tax 1 Value` — so comparing on alphanumerics alone
 * lets a header match its alias however the separator was written.
 */
function matchKey(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** RFC-4180-ish CSV reader: quotes, doubled quotes, CRLF, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuotes = false
      } else cur += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      cur = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cur += c
  }
  row.push(cur)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

/** `2026-07-18 22:41:37 +0500` (Shopify) or ISO or `YYYY-MM-DD HH:MM`. */
export function toIso(v: string): string | null {
  const t = v.trim()
  if (!t) return null
  /*
   * Shopify writes a space before the offset: "2026-07-18 22:41:37 +0500".
   * JS will not accept either the space or the compact "+0500", so normalise
   * both — the space between time and offset to a real "T", and the offset to
   * "+05:00". Only the LAST space is a date/time separator; the one before the
   * offset simply goes away.
   */
  const normalised = t
    .replace(/\s*([+-]\d{2}):?(\d{2})$/, '$1:$2')
    .replace(/\s+/, 'T')
    .trim()
  const d = new Date(normalised)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Shopify's delivery outcome. Per the Bulk Import SOP, there isn't one.
 *
 * A Shopify export says what was ordered, never what happened at the door:
 * `Fulfilled` means the parcel *left the warehouse*, and `Cancelled` usually
 * means the seller cancelled it. Neither is a buyer receiving or refusing. The
 * courier export supplies the real outcome, matched back onto these orders, and
 * anything still unmatched stays unknown.
 *
 * So Shopify rows import as `pending` (unknown) — deliberately, even though it
 * looks like missing data. A wrong "accepted" would train the risk model on a
 * delivery that never happened, which is worse than an honest blank.
 */
function shopifyOutcome(): { outcome: Outcome; resolvedAt: string | null } {
  return { outcome: 'pending', resolvedAt: null }
}

function num(v: string): number | null {
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * An outcome written in the file itself.
 *
 * Verafo's own words first, then the words merchants and couriers actually use.
 * Only unambiguous ones are here: "delivered" cannot mean anything but accepted,
 * "rto" cannot mean anything but refused. Anything else returns null — an import
 * must never invent a delivery that did not happen, and "no outcome" is honest.
 */
function statedOutcome(v: string): Outcome | null {
  const s = v.trim().toLowerCase()
  if (!s) return null
  if (s === 'accepted' || s === 'refused' || s === 'pending') return s
  if (/(^|\b)(delivered|received|completed|paid|collected)(\b|$)/.test(s)) return 'accepted'
  if (/(^|\b)(refused|returned|return|rto|undeliverable|undelivered|cancelled|canceled|rejected)(\b|$)/.test(s)) {
    return 'refused'
  }
  if (/(^|\b)(in transit|intransit|shipped|dispatched|out for delivery|processing|on hold|pending)(\b|$)/.test(s)) {
    return 'pending'
  }
  return null
}

/**
 * An order number as a merchant writes it: Shopify exports `#SC1010`, and the
 * leading `#` is decoration. Stripping it here means the same order written
 * either way groups together instead of becoming two orders.
 */
function orderReference(v: string): string {
  return v.trim().replace(/^#\s*/, '')
}

interface Partial {
  line: number
  reference: string
  phone: string
  email: string
  store: string
  category: string
  product: string
  price: number | null
  quantity: number
  address: string
  city: string
  ordered_at: string | null
  outcome: Outcome | null
  resolved_at: string | null
}

/** Build the column index: field → first column that maps to it. */
function buildColumns(header: string[]): Map<string, number> {
  const col = new Map<string, number>()
  header.forEach((h, i) => {
    const mapped = HEADER_ALIASES[matchKey(h)]
    if (mapped && !col.has(mapped)) col.set(mapped, i)
  })
  return col
}

/**
 * Overlay a mapping that came from somewhere other than the alias table —
 * today that is the model in `ai-column-map.ts`, reading a spreadsheet this
 * parser has never seen ("Shipping Number", "Order Status", "Amount Paid").
 *
 * The mapping only ever names fields; every value is still read, cleaned and
 * validated here. That is the point: a wrong guess produces an empty column or
 * a skipped row, never a wrong price.
 */
export interface CsvMap {
  /** field → header as it appears in the file */
  columns: Record<string, string | undefined>
  /** lowercased cell value → outcome */
  status?: Record<string, Outcome>
}

function applyMap(header: string[], col: Map<string, number>, map?: CsvMap): Map<string, number> {
  if (!map) return col
  const byHeader = new Map(header.map((h, i) => [matchKey(h), i]))
  for (const [field, name] of Object.entries(map.columns)) {
    if (!name) continue
    const idx = byHeader.get(matchKey(name))
    // Only real headers, and only fields the rest of the parser understands.
    if (idx !== undefined && MAP_FIELDS.has(field) && !col.has(field)) col.set(field, idx)
  }
  return col
}

const MAP_FIELDS = new Set([
  'phone',
  'phone_alt',
  'product',
  'category',
  'price',
  'quantity',
  'city',
  'address',
  'store',
  'ordered_at',
  'outcome',
  'resolved_at',
  'email',
  'reference',
])

/**
 * The status column of a stranger's file, read through the mapping it came with.
 * "Delivered" → accepted, "RTO" → refused, "In transit" → pending. Only values
 * the model actually saw in the file are in the map, so an unknown word falls
 * back to the built-in vocabulary rather than to a guess.
 */
function mappedOutcome(value: string, map?: CsvMap): Outcome | null {
  if (!map?.status) return null
  const key = value.trim().toLowerCase()
  if (!key) return null
  return map.status[key] ?? null
}

/** First non-empty value among several possible columns. */
function firstOf(get: (k: string) => string, keys: string[]): string {
  for (const k of keys) {
    const v = get(k)
    if (v) return v
  }
  return ''
}

/**
 * Parse an order file into orders.
 *
 * Merchant-friendly by design: a missing `store` column is not an error here.
 * The caller decides which store the file belongs to (a merchant has exactly
 * one), and only complains when it genuinely cannot tell.
 */
export function parseOrderCsv(text: string, map?: CsvMap): ParseResult {
  const cells = parseCsv(text)
  if (cells.length === 0) {
    return { orders: [], headers: [], format: null, errors: ['File is empty'], skipped: 0 }
  }

  const rawHeaders = cells[0].map((h) => h.trim())
  const col = applyMap(rawHeaders, buildColumns(rawHeaders), map)
  const normalised = new Set(rawHeaders.map(matchKey))

  /*
   * Shopify first, deliberately. A Shopify export also carries a plain
   * `Phone` column, so testing for Verafo's `phone` first would classify every
   * real Shopify file as a Verafo one and then take one order per line item.
   * The line-item columns are what make a Shopify export unmistakable.
   */
  const isShopify = normalised.has('lineitemname') || (normalised.has('createdat') && normalised.has('name'))
  // A mapped file is neither Shopify's nor Verafo's: it is its own shape, and
  // it has already been understood.
  const format: ParseResult['format'] = isShopify
    ? 'shopify'
    : normalised.has('phone') || map
      ? 'verafo'
      : null

  if (format === null) {
    return {
      orders: [],
      headers: rawHeaders,
      format,
      errors: [
        'Could not read this file. Upload a Shopify orders export, or use Verafo\'s own template (phone, store, category, product, price, quantity, address, city, ordered_at, outcome, resolved_at).',
      ],
      skipped: 0,
    }
  }
  if (!col.has('phone')) {
    return {
      orders: [],
      headers: rawHeaders,
      format,
      errors: [
        format === 'shopify'
          ? 'This Shopify export has no phone column. Verafo identifies a buyer by phone number, so export orders with a customer phone.'
          : 'Missing required column: phone',
      ],
      skipped: 0,
    }
  }

  const errors: string[] = []
  const partials: Partial[] = []
  let skipped = 0

  for (let i = 1; i < cells.length; i++) {
    const r = cells[i]
    const get = (k: string) => (col.has(k) ? (r[col.get(k)!] ?? '').trim() : '')
    const phone = normalizePhone(
      firstOf(get, isShopify ? ['phone', 'phone_alt'] : ['phone']),
    )
    if (!phone || phone.length < 6) {
      skipped++
      continue
    }

    /*
     * Shopify has no outcome column — delivery is implied by the timestamps —
     * so it is derived there. Verafo's own template states the outcome
     * outright, and deriving from empty Shopify columns would silently
     * overwrite it with "pending". Each format uses its own source.
     */
    const derived = isShopify
      ? shopifyOutcome()
      : {
          outcome: mappedOutcome(get('outcome'), map) ?? statedOutcome(get('outcome')),
          resolvedAt: toIso(get('resolved_at')),
        }
    const quantity = Math.max(1, parseInt(get('quantity'), 10) || 1)
    const unit = num(get('price'))

    partials.push({
      line: i + 1,
      reference: orderReference(get('reference')),
      phone,
      email: get('email'),
      store: get('store'),
      category: get('category'),
      product: get('product'),
      // Line total, so an order's figure is what the merchant actually sold.
      price: unit == null ? null : unit * quantity,
      quantity,
      address: isShopify
        ? firstOf(get, ['address', 'address_alt', 'address_alt2', 'address_alt3'])
        : get('address'),
      city: isShopify ? firstOf(get, ['city', 'city_alt']) : get('city'),
      ordered_at: toIso(get('ordered_at')),
      outcome: derived.outcome,
      resolved_at: derived.resolvedAt,
    })
  }

  if (partials.length === 0) {
    errors.push(
      skipped > 0
        ? `No row carried a usable phone number (${skipped} row${skipped === 1 ? '' : 's'} had none). Verafo identifies a buyer by phone.`
        : 'No data rows found below the header.',
    )
    return { orders: [], headers: rawHeaders, format, errors, skipped }
  }

  return {
    orders: mergeShopifyLineItems(partials, isShopify),
    headers: rawHeaders,
    format,
    errors,
    skipped,
  }
}

/**
 * Fold a Shopify export's line items into orders.
 *
 * Shopify writes one row per line item, so an order with three products is
 * three rows sharing a Name. Left as-is that becomes three orders with the
 * same total, which would corrupt both the order count and the buyer's score.
 * Rows are keyed by order number, so interleaved orders merge correctly too.
 *
 * The merged order carries the sum of its line totals and the sum of its
 * quantities, so its amount is the order amount.
 */
function mergeShopifyLineItems(partials: Partial[], isShopify: boolean): ParsedOrder[] {
  if (!isShopify) {
    return partials.map((p) => ({ ...p, lineItems: 1 }) as ParsedOrder)
  }

  const byKey = new Map<string, ParsedOrder>()
  for (const p of partials) {
    // Fall back to the row's own line number when a file has no order number,
    // so unrelated rows can never be merged into one order.
    const key = p.reference || `#line-${p.line}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...p, lineItems: 1 })
      continue
    }
    existing.lineItems++
    existing.quantity += p.quantity
    if (p.price != null) existing.price = (existing.price ?? 0) + p.price
    if (p.product) existing.product = existing.product ? `${existing.product} · ${p.product}` : p.product
    // Keep first non-empty values; the customer block repeats on every row.
    existing.address ||= p.address
    existing.city ||= p.city
    existing.store ||= p.store
    existing.category ||= p.category
    existing.email ||= p.email
    existing.ordered_at ||= p.ordered_at
    existing.resolved_at ||= p.resolved_at
    if (existing.outcome === 'pending' && p.outcome !== 'pending') existing.outcome = p.outcome
  }
  return [...byKey.values()]
}
