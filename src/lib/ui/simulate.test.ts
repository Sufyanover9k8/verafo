import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  simulate,
  affectedBy,
  clampRules,
  explainResult,
  thresholdExplanation,
  bandOf,
  DEFAULT_RULES,
  RULE_BOUNDS,
  MIN_SAMPLE,
  type SimOrder,
  type SimRules,
} from './simulate'

const o = (over: Partial<SimOrder> = {}): SimOrder => ({
  id: Math.random().toString(36).slice(2),
  riskScore: 0.1,
  buyerOrders: 5,
  price: 1000,
  quantity: 1,
  outcome: 'accepted',
  ...over,
})

/* ─────────────────────────────────────────────────────────────
   Safety. These are the tests that matter most: the simulator must
   not be able to change real data.
   ───────────────────────────────────────────────────────────── */

describe('SAFETY: read-only by construction', () => {
  it('never mutates the orders it is given', () => {
    const orders = [o({ riskScore: 0.9 }), o({ riskScore: 0.1 }), o({ outcome: 'refused' })]
    const snapshot = JSON.parse(JSON.stringify(orders))
    simulate(orders, { scoreThreshold: 0.5, valueThreshold: null, includeUnknown: true })
    expect(orders).toEqual(snapshot)
  })

  it('never mutates the rules object it is given', () => {
    const rules: SimRules = { scoreThreshold: 5, valueThreshold: -10, includeUnknown: true }
    const snapshot = { ...rules }
    simulate([o()], rules)
    expect(rules).toEqual(snapshot)
  })

  it('does not change an outcome, even for orders it flags', () => {
    const orders = [o({ riskScore: 0.95, outcome: 'pending' }), o({ riskScore: 0.95, outcome: 'refused' })]
    simulate(orders, { scoreThreshold: 0.45, valueThreshold: null, includeUnknown: true })
    expect(orders.map((x) => x.outcome)).toEqual(['pending', 'refused'])
  })

  it('returns outcome values that mirror the input, so the UI cannot be misled', () => {
    const r = simulate([o({ outcome: 'refused', riskScore: 0.9 })], DEFAULT_RULES)
    expect(r.affected.refused).toBe(1)
    expect(r.affected.accepted).toBe(0)
  })

  it('the module imports nothing that can write to the database', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/ui/simulate.ts'), 'utf8')
    // Inspect the import statements only.
    const imports = [...src.matchAll(/^\s*import[^;]+;/gm)].map((m) => m[0]).join('\n')
    expect(imports).not.toMatch(/supabase/i)
    expect(imports).not.toMatch(/fetch|axios|XMLHttpRequest/)
    expect(imports).not.toMatch(/\.server/)
    // And no write verbs anywhere in the file.
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/)
  })

  it('says plainly that nothing was changed', () => {
    const lines = explainResult(simulate([o({ riskScore: 0.9 })], DEFAULT_RULES), DEFAULT_RULES)
    expect(lines.join(' ')).toContain('hypothetical')
    expect(lines.join(' ')).toContain('Nothing has been changed')
  })

  it('never claims a saving or a prevention, and only ever denies them', () => {
    const cases: SimRules[] = [
      { scoreThreshold: 0.45, valueThreshold: null, includeUnknown: false },
      { scoreThreshold: 0.9, valueThreshold: 500, includeUnknown: true },
    ]
    for (const rules of cases) {
      const text = explainResult(simulate([o({ riskScore: 0.9, outcome: 'refused' })], rules), rules).join(' ')

      // Nothing may be presented as money back or a loss stopped.
      expect(text).not.toMatch(/\bprevented\b/i)

      // If those words appear at all, every use must be a denial.
      for (const m of text.matchAll(/[^.]*\b(saved|saving|recovered)\b[^.]*\./gi)) {
        expect(m[0]).toMatch(/\bnot\b|\bno\b/i)
      }
    }
  })

  it('calls order value order value, not profit', () => {
    const text = explainResult(simulate([o({ riskScore: 0.9, price: 5000 })], DEFAULT_RULES), DEFAULT_RULES).join(' ')
    expect(text).toContain('order value, not profit')
  })
})

/* ───────────────────────────────────────────────────────────── */

describe('clampRules', () => {
  it('keeps a threshold inside its bounds', () => {
    expect(clampRules({ ...DEFAULT_RULES, scoreThreshold: 5 }).scoreThreshold).toBe(RULE_BOUNDS.scoreThreshold.max)
    expect(clampRules({ ...DEFAULT_RULES, scoreThreshold: -1 }).scoreThreshold).toBe(RULE_BOUNDS.scoreThreshold.min)
  })

  it('falls back to the default for a non-number', () => {
    expect(clampRules({ ...DEFAULT_RULES, scoreThreshold: Number.NaN }).scoreThreshold).toBe(
      DEFAULT_RULES.scoreThreshold,
    )
  })

  it('treats a null value threshold as no value rule', () => {
    expect(clampRules({ ...DEFAULT_RULES, valueThreshold: null }).valueThreshold).toBeNull()
    expect(clampRules({ ...DEFAULT_RULES, valueThreshold: Number.NaN }).valueThreshold).toBeNull()
  })

  it('clamps a negative value threshold to zero', () => {
    expect(clampRules({ ...DEFAULT_RULES, valueThreshold: -50 }).valueThreshold).toBe(0)
  })
})

describe('affectedBy', () => {
  it('catches an order at or above the score threshold', () => {
    expect(affectedBy({ ...DEFAULT_RULES, scoreThreshold: 0.45 }, o({ riskScore: 0.45 }))).toEqual({
      affected: true,
      reason: 'score',
    })
  })

  it('leaves an order below the threshold alone', () => {
    expect(affectedBy({ ...DEFAULT_RULES, scoreThreshold: 0.65 }, o({ riskScore: 0.5 })).affected).toBe(false)
  })

  it('catches a high-value order when a value rule is set', () => {
    const r = affectedBy(
      { scoreThreshold: 0.9, valueThreshold: 5000, includeUnknown: false },
      o({ riskScore: 0.1, price: 6000 }),
    )
    expect(r).toEqual({ affected: true, reason: 'value' })
  })

  it('does not catch a high-value order with no recorded price', () => {
    const r = affectedBy(
      { scoreThreshold: 0.9, valueThreshold: 5000, includeUnknown: false },
      o({ riskScore: 0.1, price: null }),
    )
    expect(r.affected).toBe(false)
  })

  it('excludes an unscored buyer unless the merchant opts in', () => {
    const order = o({ riskScore: 0.9, buyerOrders: 0 })
    expect(affectedBy(DEFAULT_RULES, order).affected).toBe(false)
    expect(affectedBy({ ...DEFAULT_RULES, includeUnknown: true }, order)).toEqual({
      affected: true,
      reason: 'unknown',
    })
  })

  it('treats a missing score as unscored even with order history', () => {
    const order = o({ riskScore: null, buyerOrders: 10 })
    expect(affectedBy(DEFAULT_RULES, order).affected).toBe(false)
    expect(affectedBy({ ...DEFAULT_RULES, includeUnknown: true }, order).reason).toBe('unknown')
  })
})

describe('simulate', () => {
  const mixed: SimOrder[] = [
    o({ riskScore: 0.9, outcome: 'refused', price: 2000 }),
    o({ riskScore: 0.8, outcome: 'accepted', price: 1000 }),
    o({ riskScore: 0.1, outcome: 'accepted', price: 5000 }),
    o({ riskScore: 0.2, outcome: 'pending', price: 700 }),
  ]

  it('splits orders into affected and untouched', () => {
    const r = simulate(mixed, { scoreThreshold: 0.45, valueThreshold: null, includeUnknown: false })
    expect(r.total).toBe(4)
    expect(r.affected.orders).toBe(2)
    expect(r.untouched.orders).toBe(2)
    expect(r.share).toBeCloseTo(0.5, 5)
  })

  it('counts only affected order value, and calls it order value', () => {
    const r = simulate(mixed, { scoreThreshold: 0.45, valueThreshold: null, includeUnknown: false })
    expect(r.affected.value).toBe(3000)
    expect(r.untouched.value).toBe(5700)
  })

  it('keeps unknown outcomes out of the refusal rate', () => {
    const r = simulate(mixed, { scoreThreshold: 0.45, valueThreshold: null, includeUnknown: false })
    expect(r.affected.accepted).toBe(1)
    expect(r.affected.refused).toBe(1)
    expect(r.affected.unknown).toBe(0)
    expect(r.affected.refusalRate).toBeCloseTo(0.5, 5)
    expect(r.untouched.unknown).toBe(1)
    expect(r.untouched.resolved).toBe(1)
  })

  it('flags a sample too small to conclude from', () => {
    const r = simulate([o({ riskScore: 0.9, outcome: 'refused' })], DEFAULT_RULES)
    expect(r.tooSmall).toBe(true)
    expect(explainResult(r, DEFAULT_RULES).join(' ')).toContain(`below ${MIN_SAMPLE}`)
  })

  it('does not flag a sample at the minimum size', () => {
    const rows = Array.from({ length: MIN_SAMPLE }, () => o({ riskScore: 0.9, outcome: 'refused' }))
    expect(simulate(rows, DEFAULT_RULES).tooSmall).toBe(false)
  })

  it('counts orders with no price separately', () => {
    const r = simulate([o({ price: null }), o({ price: 100 })], DEFAULT_RULES)
    expect(r.withoutPrice).toBe(1)
  })

  it('counts unscored buyers', () => {
    const r = simulate([o({ buyerOrders: 0 }), o({ buyerOrders: 4 })], DEFAULT_RULES)
    expect(r.unscored).toBe(1)
  })

  it('handles an empty history without inventing anything', () => {
    const r = simulate([], DEFAULT_RULES)
    expect(r.total).toBe(0)
    expect(r.affected.orders).toBe(0)
    expect(r.affected.value).toBeNull()
    expect(r.affected.refusalRate).toBeNull()
    expect(r.share).toBe(0)
    expect(explainResult(r, DEFAULT_RULES)).toEqual(['There are no orders to test this rule against yet.'])
  })

  it('reports a null value rather than zero when nothing had a price', () => {
    const r = simulate([o({ price: null })], DEFAULT_RULES)
    expect(r.affected.value).toBeNull()
  })

  it('a stricter threshold never affects more orders than a looser one', () => {
    const loose = simulate(mixed, { scoreThreshold: 0.45, valueThreshold: null, includeUnknown: false })
    const strict = simulate(mixed, { scoreThreshold: 0.75, valueThreshold: null, includeUnknown: false })
    expect(strict.affected.orders).toBeLessThanOrEqual(loose.affected.orders)
  })

  it('including unknown buyers can only add orders, never remove them', () => {
    const without = simulate(mixed, { ...DEFAULT_RULES, includeUnknown: false })
    const withIt = simulate(mixed, { ...DEFAULT_RULES, includeUnknown: true })
    expect(withIt.affected.orders).toBeGreaterThanOrEqual(without.affected.orders)
  })
})

describe('thresholdExplanation', () => {
  it('describes each band in plain words', () => {
    expect(thresholdExplanation(0.5)).toContain('MEDIUM RISK')
    expect(thresholdExplanation(0.9)).toContain('only HIGH RISK')
    // Below the LOW/MEDIUM boundary the rule is catching buyers Verafo calls low risk.
    expect(thresholdExplanation(0.3)).toContain('strict')
  })

  it('agrees with the app thresholds', () => {
    expect(bandOf(0.1)).toBe('safe')
    expect(bandOf(0.5)).toBe('watch')
    expect(bandOf(0.9)).toBe('high')
  })
})

describe('explainResult', () => {
  it('states the share affected', () => {
    const rows = Array.from({ length: 10 }, (_, i) => o({ riskScore: i < 5 ? 0.9 : 0.1 }))
    const r = simulate(rows, DEFAULT_RULES)
    expect(explainResult(r, DEFAULT_RULES)[0]).toContain('5 (50%)')
  })

  it('warns when a strict rule would have blocked accepted orders', () => {
    const rows = Array.from({ length: 12 }, () => o({ riskScore: 0.9, outcome: 'accepted' }))
    const text = explainResult(simulate(rows, DEFAULT_RULES), DEFAULT_RULES).join(' ')
    expect(text).toContain('asked those buyers to pay upfront for no reason')
  })

  it('explains that unscored orders were left out, or included by choice', () => {
    const rows = [o({ buyerOrders: 0, riskScore: 0.9 })]
    expect(explainResult(simulate(rows, DEFAULT_RULES), DEFAULT_RULES).join(' ')).toContain('left out')
    expect(
      explainResult(simulate(rows, { ...DEFAULT_RULES, includeUnknown: true }), { ...DEFAULT_RULES, includeUnknown: true }).join(' '),
    ).toContain('You chose to include them')
  })
})
