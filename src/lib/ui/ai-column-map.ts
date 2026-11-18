/* ============================================================
   ui/ai-column-map.ts — "Import with AI": let the model pick the
   columns.

   Vendors export wildly different sheets ("Vendor" vs "Store",
   "CN Number" vs "Tracking", "Remarks" vs "Outcome"). The local
   alias tables in import.ts / courier-reconciliation.ts cover the
   common ones; this asks the verafo-ai edge function to map
   whatever is left, using the header row *and* a few sample rows
   so it can see the values, not just the names.

   The result is only ever a mapping{canonicalField -> headerName};
   the model never sees or writes the actual import.
   ============================================================ */

import { functionsBaseUrl } from '../supabase'

export type ColumnKind = 'orders' | 'courier'

export interface AiColumnMap {
  mapping: Partial<Record<string, string>>
  /** Fields the model could not find a column for. */
  missing: string[]
}

/** Canonical fields each importer can use. */
export const ORDER_FIELDS = [
  'phone',
  'store',
  'product',
  'category',
  'price',
  'quantity',
  'address',
  'city',
  'ordered_at',
  'outcome',
  'resolved_at',
] as const

export const COURIER_FIELDS = [
  'reference',
  'trackingNumber',
  'phone',
  'store',
  'status',
  'reason',
  'codAmount',
  'resolvedAt',
] as const

export function fieldsFor(kind: ColumnKind): readonly string[] {
  return kind === 'courier' ? COURIER_FIELDS : ORDER_FIELDS
}

/**
 * Ask the edge function to map headers onto canonical fields.
 * Returns null when AI is unavailable (no function deployed, no OpenAI key,
 * offline) so the caller can fall back to manual mapping without breaking.
 */
export async function mapColumnsWithAi(
  headers: string[],
  sample: string[][],
  kind: ColumnKind,
): Promise<AiColumnMap | null> {
  const base = functionsBaseUrl()
  if (!base || headers.length === 0) return null

  try {
    const res = await fetch(`${base}/verafo-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'map_columns',
        kind,
        headers: headers.slice(0, 40),
        sample: sample.slice(0, 5).map((row) => row.slice(0, 40)),
      }),
    })
    if (!res.ok) return null

    const json = (await res.json()) as {
      ok?: boolean
      mapping?: Record<string, unknown>
      missing?: unknown
    }
    if (!json.ok || !json.mapping) return null

    // Only accept header names that actually exist in this file — a model
    // that hallucinates a column must not silently shift every value by one.
    const headerSet = new Set(headers)
    const mapping: Record<string, string> = {}
    for (const field of fieldsFor(kind)) {
      const header = json.mapping[field]
      if (typeof header === 'string' && headerSet.has(header)) mapping[field] = header
    }

    const missing = fieldsFor(kind).filter((f) => !mapping[f])
    return { mapping, missing }
  } catch {
    return null
  }
}
