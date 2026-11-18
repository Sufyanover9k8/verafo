/* ============================================================
   ui/import.ts — parsing and validation for CSV order imports.

   Everything here is pure: no Supabase, no React. The page does
   the network work; this module decides what the file actually
   means, and refuses to invent values when a cell is unusable.

   Behaviour worth knowing:
   · delimiter is sniffed (`,` `;` tab) so Excel in any locale works
   · a UTF-8 BOM is stripped, so the first header still matches
   · prices accept "Rs. 2,499", "1.199,00", "PKR 2499"; negatives are errors
   · dates are read as Pakistan time (+05:00) unless they carry an offset
   · outcome words are mapped from the vocabulary merchants actually use
   · every row gets a stable `importRef`, so re-importing is a no-op
   ============================================================ */

import { canonicalPhone } from '../format'

export type OutcomeStatus = 'accepted' | 'refused' | 'pending'

export const TEMPLATE_COLUMNS = [
  'phone',
  'store',
  'category',
  'product',
  'price',
  'quantity',
  'address',
  'city',
  'ordered_at',
  'outcome',
  'resolved_at',
] as const

export const TEMPLATE_CSV = [
  TEMPLATE_COLUMNS.join(','),
  '+923001112222,Sanicore,skincare,Vitamin C serum 30ml,2499,1,House 12 Block B Model Town,Lahore,2026-07-01 14:30,refused,2026-07-03 10:00',
  '+923214445555,Urban Threads,clothing,Cotton t-shirt,1199,2,PECHS Block 2,Karachi,2026-07-05 18:00,accepted,2026-07-06 12:00',
  '+923337778888,Sanicore,skincare,Retinol cream 30ml,2699,1,House 2 F-11 Markaz,Islamabad,2026-07-10 09:15,pending,',
].join('\n')

/** Header aliases, including the names Shopify/WooCommerce/Daraz exports use. */
const HEADER_ALIASES: Record<string, string> = {
  // phone
  phone: 'phone',
  buyer: 'phone',
  buyer_phone: 'phone',
  mobileno: 'phone',
  'mobile no': 'phone',
  number: 'phone',
  'shipping phone': 'phone',
  'customer phone': 'phone',
  'phone number': 'phone',
  // store
  store: 'store',
  storename: 'store',
  store_name: 'store',
  shop: 'store',
  vendor: 'store',
  // product
  product: 'product',
  productname: 'product',
  product_name: 'product',
  item: 'product',
  name: 'product',
  'lineitem name': 'product',
  'line item name': 'product',
  sku: 'product',
  // category
  category: 'category',
  product_category: 'category',
  'product type': 'category',
  type: 'category',
  style: 'category',
  // money
  price: 'price',
  amount: 'price',
  value: 'price',
  total: 'price',
  'lineitem price': 'price',
  'line item price': 'price',
  'unit price': 'price',
  revenue: 'price',
  // quantity
  quantity: 'quantity',
  qty: 'quantity',
  'lineitem quantity': 'quantity',
  'line item quantity': 'quantity',
  units: 'quantity',
  // address / city
  address: 'address',
  'shipping address': 'address',
  'shipping address1': 'address',
  address1: 'address',
  city: 'city',
  'shipping city': 'city',
  town: 'city',
  // dates
  ordered_at: 'ordered_at',
  date: 'ordered_at',
  orderdate: 'ordered_at',
  order_date: 'ordered_at',
  'created at': 'ordered_at',
  created_at: 'ordered_at',
  // outcome
  outcome: 'outcome',
  status: 'outcome',
  result: 'outcome',
  'financial status': 'outcome',
  'fulfillment status': 'outcome',
  resolved_at: 'resolved_at',
  'resolved at': 'resolved_at',
  'delivered at': 'resolved_at',
}

/** Words merchants and couriers actually use, mapped to Verafo's three states. */
const ACCEPTED_WORDS = new Set([
  'accepted',
  'delivered',
  'deliverd',
  'fulfilled',
  'completed',
  'complete',
  'paid',
  'success',
  'successful',
  'received',
  'collected',
  'closed',
])

const REFUSED_WORDS = new Set([
  'refused',
  'refuse',
  'rejected',
  'returned',
  'return',
  'rto',
  'cancelled',
  'canceled',
  'cancel',
  'failed',
  'undelivered',
  'not delivered',
  'returned to origin',
  'return_to_origin',
  'no answer',
  'unreachable',
  'voided',
  'refunded',
])

const PENDING_WORDS = new Set([
  '',
  'pending',
  'in_transit',
  'in transit',
  'intransit',
  'shipped',
  'dispatched',
  'out for delivery',
  'processing',
  'open',
  'new',
  'on hold',
  'unfulfilled',
  'authorized',
  'partially paid',
  'partially_paid',
])

export interface ParsedRow {
  line: number
  phone: string
  store: string
  category: string
  product: string
  price: number | null
  quantity: number
  address: string
  city: string
  /** ISO instant, or null when the cell was blank (database keeps "now"). */
  orderedAt: string | null
  outcome: OutcomeStatus
  resolvedAt: string | null
  /** Stable dedupe key: same row in the same store never imports twice. */
  importRef: string
  warnings: string[]
  /** A non-empty list means the row is skipped. */
  errors: string[]
}

export interface ParseResult {
  rows: ParsedRow[]
  header: string[]
  delimiter: string
  fileErrors: string[]
  /** Status words that were not recognised (they were treated as pending). */
  unknownOutcomes: string[]
  counts: {
    total: number
    ready: number
    invalid: number
    ambiguousDates: number
    correctedPrices: number
    missingDates: number
  }
}

/** Pakistan Standard Time — the market Verafo serves. */
const PK_OFFSET = '+05:00'

/** Strip a UTF-8 BOM (Excel writes one) and normalise newlines. */
export function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

/** Pick the delimiter that appears most often in the header line. */
export function sniffDelimiter(text: string): string {
  const firstLine = stripBom(text).split('\n')[0] ?? ''
  const candidates = [',', ';', '\t']
  let best = ','
  let bestCount = -1
  for (const c of candidates) {
    let count = 0
    let inQuotes = false
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i]
      if (ch === '"') {
        if (inQuotes && firstLine[i + 1] === '"') i++
        else inQuotes = !inQuotes
      } else if (!inQuotes && ch === c) count++
    }
    if (count > bestCount) {
      best = c
      bestCount = count
    }
  }
  return best
}

/** RFC4180-ish CSV: quoted fields, doubled quotes, embedded newlines. */
export function parseCsv(text: string, delimiter = sniffDelimiter(text)): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  const src = stripBom(text)

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delimiter) {
      row.push(cur)
      cur = ''
    } else if (c === '\n') {
      row.push(cur)
      cur = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else {
      cur += c
    }
  }
  row.push(cur)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

export interface PriceResult {
  value: number | null
  /** True when the raw cell was not a plain number and had to be interpreted. */
  corrected: boolean
  error?: string
}

/**
 * "2499", "2,499", "Rs. 2,499", "PKR 2499", "1.199,00" — all PKR amounts a
 * merchant can paste. Returns an error rather than a silently wrong number.
 */
export function parsePrice(raw: string): PriceResult {
  const trimmed = raw.trim()
  if (!trimmed) return { value: null, corrected: false }

  // Take the numeric run only: "Rs. 2,499" must not keep the dot after "Rs".
  const match = trimmed.match(/-?\d[\d.,\s]*/)
  if (!match) return { value: null, corrected: false, error: `"${trimmed}" is not a number` }

  let s = match[0].replace(/\s/g, '')
  const negative = s.startsWith('-')
  s = s.replace(/-/g, '')

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  const commas = (s.match(/,/g) ?? []).length

  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever separator comes last is the decimal one.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    // "2,499" and "1,20,000" are thousands groups; a single "2,49" is a decimal.
    const singleGroupOfThree = commas === 1 && /^\d{1,3},\d{3}$/.test(s)
    s = commas > 1 || singleGroupOfThree ? s.replace(/,/g, '') : s.replace(',', '.')
  } else if (lastDot >= 0) {
    const parts = s.split('.')
    // "1.199.000" is thousands; "2499.50" is a decimal.
    if (parts.length > 2) s = parts.join('')
  }

  const n = Number(s)
  if (!Number.isFinite(n)) return { value: null, corrected: true, error: `"${trimmed}" is not a number` }
  if (negative || n < 0) return { value: n, corrected: true, error: 'price cannot be negative' }

  // Flag anything that was not already a plain number, so the preview can show
  // "Rs. 2,499 → 2499" instead of quietly changing the merchant's data.
  const corrected = /[^\d.]/.test(trimmed) || s !== trimmed
  return { value: n, corrected }
}

export interface DateResult {
  iso: string | null
  /** Day/month could be swapped (both ≤ 12): parsed as DD/MM, worth flagging. */
  ambiguous: boolean
  error?: string
}

/** Parse the date formats merchants export, in Pakistan time. */
export function parseOrderDate(raw: string): DateResult {
  const t = raw.trim()
  if (!t) return { iso: null, ambiguous: false }

  // ISO-ish: 2026-07-01, 2026-07-01 14:30, 2026-07-01T14:30:00Z
  const iso = t.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/,
  )
  if (iso) {
    const [, y, mo, d, h = '0', mi = '0', sec = '0', tz] = iso
    const offset = tz ? (tz === 'Z' ? 'Z' : tz.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : PK_OFFSET
    const stamp = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(sec)}${offset}`
    return validOrError(stamp, t, false)
  }

  // 2026/07/01
  const ymd = t.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/)
  if (ymd) {
    const [, y, mo, d, h = '0', mi = '0'] = ymd
    const stamp = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${PK_OFFSET}`
    return validOrError(stamp, t, false)
  }

  // 01/07/2026 or 1-7-26 — day first, as written in Pakistan.
  const dmy = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/)
  if (dmy) {
    const [, d, mo, yRaw, h = '0', mi = '0'] = dmy
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw
    const ambiguous = Number(d) <= 12 && Number(mo) <= 12 && d !== mo
    const stamp = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00${PK_OFFSET}`
    return validOrError(stamp, t, ambiguous)
  }

  return { iso: null, ambiguous: false, error: `"${t}" is not a date Verafo understands` }
}

function pad(v: string | number): string {
  return String(v).padStart(2, '0')
}

function validOrError(stamp: string, raw: string, ambiguous: boolean): DateResult {
  const d = new Date(stamp)
  if (Number.isNaN(d.getTime())) {
    return { iso: null, ambiguous, error: `"${raw}" is not a valid date` }
  }
  const [y, mo, day] = stamp.slice(0, 10).split('-').map(Number)
  // Reject impossible calendar dates that JS would otherwise roll over.
  const check = new Date(Date.UTC(y, mo - 1, day))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== day) {
    return { iso: null, ambiguous, error: `"${raw}" is not a valid date` }
  }
  return { iso: d.toISOString(), ambiguous }
}

export interface OutcomeResult {
  status: OutcomeStatus
  known: boolean
}

/** Map a status cell to accepted/refused/pending. */
export function mapOutcome(raw: string): OutcomeResult {
  const key = raw.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (ACCEPTED_WORDS.has(key)) return { status: 'accepted', known: true }
  if (REFUSED_WORDS.has(key)) return { status: 'refused', known: true }
  if (PENDING_WORDS.has(key)) return { status: 'pending', known: true }
  return { status: 'pending', known: false }
}

/** 64-bit FNV-1a, hex. Stable across reloads, browsers and sessions. */
export function stableRef(parts: (string | number | null | undefined)[]): string {
  const input = parts.map((p) => (p == null ? '' : String(p))).join('|').toLowerCase()
  let h1 = 0x811c9dc5
  let h2 = 0xcbf29ce4
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

function toQuantity(raw: string, warnings: string[]): number {
  const t = raw.trim()
  if (!t) return 1
  const n = Number(t.replace(/[^\d.-]/g, ''))
  if (!Number.isFinite(n) || n <= 0) {
    warnings.push(`quantity "${raw}" is not usable; counted as 1`)
    return 1
  }
  return Math.max(1, Math.round(n))
}

/** Parse a whole file. Rows with `errors` must not be imported. */
export function parseImport(text: string, aiColumns: Partial<Record<string, string>> = {}): ParseResult {
  const delimiter = sniffDelimiter(text)
  const cells = parseCsv(text, delimiter)
  const fileErrors: string[] = []

  if (cells.length === 0) {
    return {
      rows: [],
      header: [],
      delimiter,
      fileErrors: ['The file is empty.'],
      unknownOutcomes: [],
      counts: { total: 0, ready: 0, invalid: 0, ambiguousDates: 0, correctedPrices: 0, missingDates: 0 },
    }
  }

  const header = cells[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, ' '))
  const col = new Map<string, number>()
  header.forEach((h, i) => {
    const mapped = HEADER_ALIASES[h]
    if (mapped && !col.has(mapped)) col.set(mapped, i)
  })

  // AI-chosen columns win: the model saw the sample values, so it can beat a
  // header-name guess ("Vendor" meaning store, "Remarks" meaning outcome).
  const byHeaderName = new Map(header.map((h, i) => [h, i]))
  for (const [field, headerName] of Object.entries(aiColumns)) {
    if (!headerName || !HEADER_ALIASES[field]) continue
    const index = byHeaderName.get(String(headerName).trim().toLowerCase().replace(/\s+/g, ' '))
    if (index !== undefined) col.set(field, index)
  }

  if (!col.has('phone')) fileErrors.push('No phone column found. A column named phone, buyer, or "Shipping Phone" works.')

  const rows: ParsedRow[] = []
  const unknownOutcomes = new Set<string>()
  let ambiguousDates = 0
  let correctedPrices = 0
  let missingDates = 0

  for (let i = 1; i < cells.length; i++) {
    const r = cells[i]
    const get = (k: string) => (col.has(k) ? (r[col.get(k)!] ?? '').trim() : '')
    const warnings: string[] = []
    const errors: string[] = []

    const rawPhone = get('phone')
    const phone = canonicalPhone(rawPhone)
    if (!rawPhone) errors.push('missing phone')
    else if (phone.replace(/\D/g, '').length < 8) errors.push(`"${rawPhone}" is not a usable phone number`)

    const price = parsePrice(get('price'))
    if (price.error) errors.push(price.error)
    if (price.corrected && !price.error) correctedPrices++

    const ordered = parseOrderDate(get('ordered_at'))
    if (ordered.error) errors.push(ordered.error)
    if (ordered.ambiguous) {
      ambiguousDates++
      warnings.push('date read as DD/MM')
    }
    if (!ordered.iso && !ordered.error) missingDates++

    const resolved = parseOrderDate(get('resolved_at'))
    if (resolved.error) errors.push(resolved.error)

    const rawOutcome = get('outcome')
    const outcome = mapOutcome(rawOutcome)
    if (!outcome.known) {
      unknownOutcomes.add(rawOutcome)
      warnings.push(`status "${rawOutcome}" treated as pending`)
    }

    const quantity = toQuantity(get('quantity'), warnings)
    const product = get('product')
    const store = get('store')

    rows.push({
      line: i + 1,
      phone,
      store,
      category: get('category'),
      product,
      price: price.value,
      quantity,
      address: get('address'),
      city: get('city'),
      orderedAt: ordered.iso,
      outcome: outcome.status,
      resolvedAt: resolved.iso,
      importRef: stableRef([phone, ordered.iso, product, price.value, quantity]),
      warnings,
      errors,
    })
  }

  const ready = rows.filter((r) => r.errors.length === 0).length
  return {
    rows,
    header,
    delimiter,
    fileErrors,
    unknownOutcomes: [...unknownOutcomes],
    counts: {
      total: rows.length,
      ready,
      invalid: rows.length - ready,
      ambiguousDates,
      correctedPrices,
      missingDates,
    },
  }
}

/** CSV for the rows that failed, so a merchant can fix and re-upload only those. */
export function failedRowsCsv(rows: { line: number; reason: string }[]): string {
  const header = 'line,reason'
  const body = rows
    .map((r) => `${r.line},"${r.reason.replace(/"/g, '""')}"`)
    .join('\n')
  return `${header}\n${body}\n`
}
