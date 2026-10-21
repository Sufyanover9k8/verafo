import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useStoreScope } from '@/lib/store'

/**
 * The shop's active plan, or null when it is unknown.
 *
 * Read-only: one select against `store_plans`. Fails silently by design — if
 * Supabase is not configured, the table has not been created yet, the network
 * fails, or row-level security returns nothing, the result is null and the
 * badge simply does not render. Nothing is logged to the console.
 *
 * A null plan must never be treated as "Free".
 */
export function usePlan(): string | null {
  const { store, loading: scopeLoading } = useStoreScope()
  const storeId = store?.id ?? null
  const [planName, setPlanName] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase || scopeLoading || !storeId) {
      setPlanName(null)
      return
    }

    let alive = true

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('store_plans')
          .select('plan_name, status')
          .eq('store_id', storeId)
          .maybeSingle()

        if (!alive) return
        if (error || !data) {
          setPlanName(null)
          return
        }

        // Only an ACTIVE plan is shown. Status is compared
        // case-insensitively so this does not depend on the exact casing
        // Shopify stores.
        const status = String(data.status ?? '').toUpperCase()
        const name = typeof data.plan_name === 'string' ? data.plan_name.trim() : ''
        setPlanName(status === 'ACTIVE' && name ? name : null)
      } catch {
        // Silent: no badge, no console noise.
        if (alive) setPlanName(null)
      }
    })()

    return () => {
      alive = false
    }
  }, [storeId, scopeLoading])

  return planName
}
