/* ============================================================
   ui/ai-column-map.ts — "Import with AI" for COURIER reports.

   Courier companies each ship a different workbook ("Vendor" vs
   "Store", "CN Number" vs "Tracking", "Remarks" vs "Outcome"). The
   local alias table in courier-reconciliation.ts covers the common
   ones; this asks the verafo-ai edge function to map whatever is
   left, using the header row *and* a few sample rows so the model
   can see the values, not just the names.

   The result is only ever a mapping{field -> headerName}; the model
   never sees or writes the import itself.
   ============================================================ */

import { functionsBaseUrl } from '../supabase'
import type { CourierRow } from './courier-reconciliation'

export type CourierField = keyof Omit<CourierRow, 'line'>

export interface AiColumnMap {
  mapping: Partial<Record<CourierField, string>>
  /** Fields the model could not find a column for. */
  missing: string[]
}

/** Canonical fields a courier report can provide. */
export const COURIER_FIELDS: readonly CourierField[] = [
  'reference',
  'trackingNumber',
  'phone',
  'store',
  'status',
  'reason',
  'codAmount',
  'resolvedAt',
]

/**
 * Ask the edge function to map courier headers onto the fields the importer
 * understands. Returns null when AI is unavailable (function not deployed, no
 * OpenAI key, offline) so the caller can fall back to alias matching.
 */
export async function mapCourierColumnsWithAi(
  headers: string[],
  sample: string[][],
): Promise<AiColumnMap | null> {
  const base = functionsBaseUrl()
  if (!base || headers.length === 0) return null

  try {
    const res = await fetch(`${base}/verafo-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'map_columns',
        kind: 'courier',
        headers: headers.slice(0, 40),
        sample: sample.slice(0, 5).map((row) => row.slice(0, 40)),
      }),
    })
    if (!res.ok) return null

    const json = (await res.json()) as { ok?: boolean; mapping?: Record<string, unknown> }
    if (!json.ok || !json.mapping) return null

    // Only accept header names that actually exist in this file — a model that
    // hallucinates a column must not silently shift every value by one.
    const headerSet = new Set(headers)
    const mapping: Partial<Record<CourierField, string>> = {}
    for (const field of COURIER_FIELDS) {
      const header = json.mapping[field]
      if (typeof header === 'string' && headerSet.has(header)) mapping[field] = header
    }

    const missing = COURIER_FIELDS.filter((f) => !mapping[f])
    return { mapping, missing }
  } catch {
    return null
  }
}
