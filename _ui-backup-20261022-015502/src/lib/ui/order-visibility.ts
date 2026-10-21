/* ============================================================
   lib/ui/order-visibility.ts — hide an order, never delete it.

   The order book is the training set for the risk model, so "delete" in the
   product means "stop showing me this row". The database keeps every row and
   its outcome; `orders.deleted_at` is the only thing that changes.

   The column may not exist yet (the migration is applied by hand). Every read
   path therefore probes once and simply skips the filter when it is absent, so
   the Orders page cannot break because a migration has not run.
   ============================================================ */

import { supabase } from '@/lib/supabase'

/** null until probed. Kept module-level: one request per page load, not per list. */
let ready: boolean | null = null
let checkedAt = 0
/**
 * A "no" is only believed briefly. The migration can be run while the app is
 * open, and the Refresh button should then turn the feature on rather than
 * needing a full page reload.
 */
const NEGATIVE_TTL_MS = 15_000

/** True when `orders.deleted_at` exists and hiding is available. */
export async function softDeleteReady(): Promise<boolean> {
  if (ready === true) return true
  if (ready === false && Date.now() - checkedAt < NEGATIVE_TTL_MS) return false
  checkedAt = Date.now()
  if (!supabase) {
    ready = false
    return false
  }
  const { error } = await supabase.from('orders').select('deleted_at').limit(1)
  ready = !error
  return ready
}

export interface HideResult {
  changed: number
  error?: string
}

/**
 * Hide or restore orders. One database function for both directions, so a hide
 * can always be undone and the two can never disagree about who may do it.
 */
export async function setOrdersHidden(ids: string[], hidden: boolean): Promise<HideResult> {
  if (!supabase) return { changed: 0, error: 'Supabase is not configured' }
  if (ids.length === 0) return { changed: 0 }
  const { data, error } = await supabase.rpc('verafo_set_orders_hidden', {
    p_ids: ids,
    p_hidden: hidden,
  })
  if (error) {
    const missing = /schema cache|could not find the function|does not exist/i.test(error.message)
    return {
      changed: 0,
      error: missing
        ? 'Hiding orders is not set up in the database yet. Run supabase/order-soft-delete.sql, then try again.'
        : error.message,
    }
  }
  return { changed: Number(data ?? 0) }
}

/** How many orders are hidden, for the "Hidden" filter chip. */
export async function countHiddenOrders(): Promise<number> {
  if (!supabase) return 0
  if (!(await softDeleteReady())) return 0
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .not('deleted_at', 'is', null)
  if (error) return 0
  return count ?? 0
}
