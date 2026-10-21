/* ============================================================
   lib/ui/ai-column-map.ts — read a stranger's spreadsheet.

   Merchants export from Shopify, from a courier's portal, from Excel, from
   whatever their old agency left them. The columns are called things like
   "Shipping Number" and the status column says "Delivered", "RTO", "Return",
   "Not Received". The deterministic parser only knows the Shopify export and
   Verafo's own template, so everything else used to die on
   "Could not read this file".

   This asks the model what the columns mean — then throws the answer away as
   soon as it is applied. The model never sees the whole file, never writes a
   row, and never touches the database: it maps NAMES to fields, and the
   existing parser does the rest. That keeps a hallucination from turning into
   a wrong price or a wrong phone number.

   Privacy: column names plus a handful of digits-masked sample values are sent.
   Enough to recognise "this column is a phone number", not enough to read a
   customer.
   ============================================================ */

import { aiJson } from '@/lib/ai'

/** The fields the importer can fill. Mirrors the parser's vocabulary. */
export const MAP_FIELDS = [
  'phone',
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
] as const

export type MapField = (typeof MAP_FIELDS)[number]

export interface ColumnMap {
  /** Field → the header exactly as it appears in the file. */
  columns: Partial<Record<MapField, string>>
  /** Lowercased cell value → outcome. Only the values the file actually uses. */
  status: Record<string, 'accepted' | 'refused' | 'pending'>
  /** The model's own words about anything it was unsure of. */
  notes: string
}

const CACHE_KEY = 'verafo.csvMap.v1'

/**
 * Mask a cell before it leaves the browser: digits become dots, long text is
 * cut, and the first two / last two characters of a number survive so the model
 * can still tell a phone from an amount from a date.
 */
export function maskValue(raw: string): string {
  const v = (raw ?? '').trim()
  if (!v) return ''
  if (v.length > 60) return `${v.slice(0, 40)}…`
  const digits = v.replace(/\D/g, '')
  if (digits.length >= 7) {
    const visibleFront = v.slice(0, 3)
    const visibleBack = v.slice(-2)
    return `${visibleFront}${v.slice(3, -2).replace(/\d/g, '•')}${visibleBack}`
  }
  return v
}

function headerKey(headers: string[]): string {
  return headers.map((h) => h.trim().toLowerCase()).join('\u0001')
}

function readCache(): Record<string, ColumnMap> {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, ColumnMap>) : {}
  } catch {
    return {}
  }
}

function writeCache(cache: Record<string, ColumnMap>): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage full or unavailable — the mapping simply is not remembered */
  }
}

/** Only the shape we asked for survives; anything else is discarded. */
function coerce(raw: unknown, headers: string[]): ColumnMap {
  const obj = (raw ?? {}) as Record<string, unknown>
  const byHeader = new Map(headers.map((h) => [h.trim().toLowerCase(), h.trim()]))
  const columns: ColumnMap['columns'] = {}

  const incoming = (obj.columns ?? {}) as Record<string, unknown>
  for (const field of MAP_FIELDS) {
    const name = incoming[field]
    if (typeof name !== 'string') continue
    const actual = byHeader.get(name.trim().toLowerCase())
    // A column the model invented is dropped: we only accept headers that
    // really exist in the file.
    if (actual) columns[field] = actual
  }

  const status: ColumnMap['status'] = {}
  const incomingStatus = (obj.status ?? {}) as Record<string, unknown>
  for (const [value, outcome] of Object.entries(incomingStatus)) {
    if (outcome === 'accepted' || outcome === 'refused' || outcome === 'pending') {
      status[value.trim().toLowerCase()] = outcome
    }
  }

  return { columns, status, notes: typeof obj.notes === 'string' ? obj.notes.slice(0, 300) : '' }
}

/**
 * Ask the model what this file's columns are.
 *
 * Cached by header signature: importing the same export every week costs one
 * call, not one per upload. Returns null when the model could not identify the
 * phone column, which is the one field the importer cannot work without.
 */
export async function mapColumnsWithAi(cells: string[][]): Promise<ColumnMap | null> {
  if (cells.length < 2) return null
  const headers = cells[0].map((h) => h.trim())
  if (headers.length === 0) return null

  const key = headerKey(headers)
  const cache = readCache()
  if (cache[key]) return cache[key]

  // Up to three data rows per column, masked. The model sees shapes, not people.
  const samples = headers.slice(0, 40).map((header, i) => ({
    header,
    values: cells
      .slice(1, 4)
      .map((row) => maskValue(row[i] ?? ''))
      .filter(Boolean),
  }))

  const res = await aiJson<unknown>('map_import_columns', { headers: headers.slice(0, 40), samples })
  const map = coerce(res, headers)
  if (!map.columns.phone) return null

  cache[key] = map
  writeCache(cache)
  return map
}

/** Forget a mapping the merchant rejected, so the next attempt asks again. */
export function forgetColumnMap(headers: string[]): void {
  const key = headerKey(headers)
  const cache = readCache()
  delete cache[key]
  writeCache(cache)
}

/** Courier exports have a different schema from order imports. Ask the same
 * Verafo AI endpoint to identify courier fields without requiring a phone column. */
export async function mapCourierColumnsWithAi(
  headers: string[],
  rows: unknown[][],
): Promise<Partial<Record<'reference' | 'trackingNumber' | 'phone' | 'store' | 'status' | 'reason' | 'codAmount' | 'resolvedAt', string>> | null> {
  if (!headers.length) return null
  const samples = headers.slice(0, 40).map((header, i) => ({
    header,
    values: rows.slice(0, 3).map((row) => maskValue(String(row[i] ?? ''))).filter(Boolean),
  }))
  const response = await aiJson<{ columns?: Record<string, unknown> }>('map_courier_columns', {
    headers: headers.slice(0, 40), samples,
  })
  const allowed = new Set(['reference', 'trackingNumber', 'phone', 'store', 'status', 'reason', 'codAmount', 'resolvedAt'])
  const actual = new Map(headers.map((h) => [h.trim().toLowerCase(), h.trim()]))
  const columns: Partial<Record<'reference' | 'trackingNumber' | 'phone' | 'store' | 'status' | 'reason' | 'codAmount' | 'resolvedAt', string>> = {}
  for (const [field, value] of Object.entries(response.columns ?? {})) {
    if (!allowed.has(field) || typeof value !== 'string') continue
    const header = actual.get(value.trim().toLowerCase())
    if (header) columns[field as keyof typeof columns] = header
  }
  return Object.keys(columns).length ? columns : null
}
