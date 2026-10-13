import { describe, expect, it } from 'vitest'
import {
  mayAccessPrivateData,
  mayAccessAggregate,
  storeFilter,
  assertScoped,
  auditOutput,
  NO_CALLER,
  FORBIDDEN_OUTPUT_KEYS,
  type CallerIdentity,
} from './edge-authz'

const merchant = (storeIds: string[]): CallerIdentity => ({ email: 'shop@example.com', storeIds })

describe('SAFETY: unauthenticated and empty-store callers are denied', () => {
  it('denies a caller with no identity at all', () => {
    expect(mayAccessPrivateData(NO_CALLER).allowed).toBe(false)
    expect(mayAccessAggregate(NO_CALLER).allowed).toBe(false)
  })

  it('denies an empty email even when store ids are present', () => {
    // A forged header could produce store ids without a verified identity.
    expect(mayAccessPrivateData({ email: '', storeIds: ['s1'] }).allowed).toBe(false)
  })

  it('denies a signed-in caller who owns no store', () => {
    const d = mayAccessPrivateData({ email: 'a@b.com', storeIds: [] })
    expect(d.allowed).toBe(false)
    expect(d.reason).toContain('not linked to any store')
  })

  it('never treats an empty store list as permission for an unfiltered query', () => {
    // The single most important assertion in this file.
    expect(storeFilter({ email: 'a@b.com', storeIds: [] })).toBeNull()
    expect(storeFilter(NO_CALLER)).toBeNull()
  })

  it('allows a signed-in caller who owns a store', () => {
    expect(mayAccessPrivateData(merchant(['s1'])).allowed).toBe(true)
  })

  it('allows aggregate access without owning a store, because that is the product', () => {
    expect(mayAccessAggregate({ email: 'a@b.com', storeIds: [] }).allowed).toBe(true)
  })
})

describe('storeFilter', () => {
  it('builds a filter for the caller own stores', () => {
    expect(storeFilter(merchant(['a', 'b']))).toBe('store_id=in.("a","b")')
  })

  it('strips quotes so an id cannot break out of the filter', () => {
    expect(storeFilter(merchant(['a"b']))).toBe('store_id=in.("ab")')
  })

  it('single store works', () => {
    expect(storeFilter(merchant(['only']))).toBe('store_id=in.("only")')
  })

  it('refuses rather than degrading to an empty filter', () => {
    expect(storeFilter(merchant([]))).toBeNull()
  })
})

describe('assertScoped', () => {
  it('throws when the query has no store filter', () => {
    expect(() => assertScoped('select=price&limit=10', merchant(['s1']))).toThrow(/unscoped private query/)
  })

  it('throws when the caller has no authorized stores, even with a filter present', () => {
    expect(() => assertScoped('store_id=in.("s1")', merchant([]))).toThrow(/no authorized stores/)
  })

  it('passes for a scoped query by an authorized caller', () => {
    expect(() => assertScoped('select=price&store_id=in.("s1")', merchant(['s1']))).not.toThrow()
  })
})

describe('auditOutput', () => {
  it('flags a leaked embedding', () => {
    const r = auditOutput({ buyer: { embedding: [0.1, 0.2] } })
    expect(r.ok).toBe(false)
    expect(r.violations).toContain('$.buyer.embedding')
  })

  it('flags a leaked feature vector and address', () => {
    const r = auditOutput([{ feature_vector: [1], nested: { address: '12 Main St' } }])
    expect(r.ok).toBe(false)
    expect(r.violations).toContain('$[0].feature_vector')
    expect(r.violations).toContain('$[0].nested.address')
  })

  it('flags every forbidden key name case-insensitively', () => {
    for (const key of FORBIDDEN_OUTPUT_KEYS) {
      const r = auditOutput({ [key.toUpperCase()]: 'x' })
      expect(r.ok).toBe(false)
      expect(r.violations).toHaveLength(1)
    }
  })

  it('passes a clean aggregate result', () => {
    const r = auditOutput({
      count: 12,
      orders: [{ product: 'Serum', city: 'Lahore', price: 1200, status: 'accepted' }],
    })
    expect(r.ok).toBe(true)
    expect(r.violations).toEqual([])
  })

  it('passes a similarity result, which carries no phone and no vector', () => {
    const r = auditOutput([{ similarity: 0.12, risk_score: 0.1, total_orders: 5, total_refused: 0 }])
    expect(r.ok).toBe(true)
  })

  it('does not flag an ordinary phone field, which is allowed for the merchant own buyer', () => {
    const r = auditOutput({ phone: '+923001234567' })
    expect(r.ok).toBe(true)
  })

  it('handles null, primitives and empty structures', () => {
    expect(auditOutput(null).ok).toBe(true)
    expect(auditOutput(undefined).ok).toBe(true)
    expect(auditOutput(42).ok).toBe(true)
    expect(auditOutput([]).ok).toBe(true)
    expect(auditOutput({}).ok).toBe(true)
  })

  it('reaches a forbidden key nested inside arrays of arrays', () => {
    const r = auditOutput({ rows: [[{ embedding: [1] }]] })
    expect(r.ok).toBe(false)
    expect(r.violations).toEqual(['$.rows[0][0].embedding'])
  })
})
