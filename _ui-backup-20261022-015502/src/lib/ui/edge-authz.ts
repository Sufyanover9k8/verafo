/* ============================================================
   ui/edge-authz.ts — the authorization rules the edge function
   enforces, as pure functions so they can be tested.

   WHY THIS FILE EXISTS
   The `verafo-ai` edge function runs on the SERVICE ROLE key, so RLS
   cannot separate merchants inside it. The only thing standing between
   one merchant and another's private order data is the logic here.
   That logic is therefore the highest-value thing in the codebase to
   have tests for, and it cannot live only inside a Deno file that the
   Vite test runner cannot import.

   The edge function keeps its own copy of these rules (it must, because
   Deno and the browser bundle do not share modules). The tests below
   pin the behaviour, and the edge function's copy is verified by
   inspection against them.

   RULES (VERAFO-STATUS.md R1-R7)
   · No token, invalid token, or no owned stores  -> DENY. Never "no filter".
   · Owned stores                                  -> private data scoped to them.
   · Cross-store AGGREGATE intelligence            -> allowed, unscoped.
   ============================================================ */

export interface CallerIdentity {
  /** Lowercased email from a verified JWT, or "" when unverified. */
  email: string
  /** Store ids the caller owns. Empty means they own nothing. */
  storeIds: string[]
}

export const NO_CALLER: CallerIdentity = { email: '', storeIds: [] }

export interface AuthzDecision {
  allowed: boolean
  /** Sentence to hand back when denied. Empty when allowed. */
  reason: string
}

/**
 * May this caller run a tool that returns PRIVATE order or buyer detail?
 * Private means addresses, cities, individual orders, amounts, phone numbers.
 */
export function mayAccessPrivateData(caller: CallerIdentity): AuthzDecision {
  if (!caller.email) {
    return {
      allowed: false,
      reason: 'Not allowed: you are not signed in, or your session could not be verified.',
    }
  }
  if (!caller.storeIds || caller.storeIds.length === 0) {
    return {
      allowed: false,
      reason:
        'Not allowed: this question needs order-level detail, and your account is not linked to any store. Ask about aggregate figures instead, or use a store you own.',
    }
  }
  return { allowed: true, reason: '' }
}

/**
 * May this caller run an AGGREGATE network tool?
 * Cross-store aggregate intelligence is an allowed product feature (R1), so
 * this needs a verified identity but no owned store.
 */
export function mayAccessAggregate(caller: CallerIdentity): AuthzDecision {
  if (!caller.email) {
    return {
      allowed: false,
      reason: 'Not allowed: you are not signed in, or your session could not be verified.',
    }
  }
  return { allowed: true, reason: '' }
}

/**
 * Build the PostgREST store filter for a private query.
 *
 * Returns null when nothing may be read. **This is the critical function:**
 * returning an empty string here would produce an unfiltered query, which is
 * exactly the cross-merchant leak this whole change exists to prevent. So it
 * refuses instead of degrading to "no filter".
 */
export function storeFilter(caller: CallerIdentity): string | null {
  if (!mayAccessPrivateData(caller).allowed) return null
  const ids = caller.storeIds.map((id) => `"${String(id).replace(/"/g, '')}"`)
  return `store_id=in.(${ids.join(',')})`
}

/**
 * A last-resort check before a private query runs.
 * Throws rather than returning data, because a silent leak is worse than a
 * broken feature.
 */
export function assertScoped(params: string, caller: CallerIdentity): void {
  if (!params.includes('store_id=')) {
    throw new Error(
      'refusing an unscoped private query: private data must be filtered to the caller\'s stores',
    )
  }
  if (!mayAccessPrivateData(caller).allowed) {
    throw new Error('refusing a private query for a caller with no authorized stores')
  }
}

/* ── Output auditing ───────────────────────────────────────── */

/** Field names that must never appear in a tool result. */
export const FORBIDDEN_OUTPUT_KEYS = [
  'embedding',
  'feature_vector',
  'address',
  'refusal_reason',
] as const

export interface OutputAudit {
  ok: boolean
  /** Every forbidden key found, with the path it was found at. */
  violations: string[]
}

/**
 * Walk a tool result looking for fields that must never reach a merchant.
 *
 * Phone numbers are NOT forbidden outright: a merchant may look up a number
 * they already typed, and their own buyers' numbers are theirs. What matters
 * is that another merchant's number is never returned by a *list* tool, which
 * is enforced by the tools themselves and by `similar_buyers_by_phone`
 * returning no phone column at all.
 */
export function auditOutput(value: unknown, path = '$'): OutputAudit {
  const violations: string[] = []

  function walk(v: unknown, p: string) {
    if (v == null) return
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`))
      return
    }
    if (typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const lower = k.toLowerCase()
        if ((FORBIDDEN_OUTPUT_KEYS as readonly string[]).includes(lower)) {
          violations.push(`${p}.${k}`)
        }
        walk(val, `${p}.${k}`)
      }
    }
  }

  walk(value, path)
  return { ok: violations.length === 0, violations }
}
