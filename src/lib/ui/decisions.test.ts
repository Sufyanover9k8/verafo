import { describe, expect, it } from 'vitest'
import {
  DECISIONS,
  DECISION_META,
  recommend,
  latestByOrder,
  needsDecision,
  validateDecision,
  type DecisionRecord,
} from './decisions'

describe('DECISION_META', () => {
  it('covers every decision', () => {
    for (const d of DECISIONS) {
      expect(DECISION_META[d].label).toBeTruthy()
      expect(DECISION_META[d].help).toBeTruthy()
    }
  })

  it('says plainly that ship anyway does not fulfil the order', () => {
    expect(DECISION_META.ship.help).toContain('does not fulfil')
    expect(DECISION_META.ship.weight).toBe('caution')
  })

  it('says Verafo does not send the WhatsApp message', () => {
    expect(DECISION_META.confirm_whatsapp.help).toContain('Nothing is sent by Verafo')
  })
})

describe('recommend', () => {
  it('never calls thin history fraud, and asks to confirm instead', () => {
    const r = recommend({ riskScore: 0.9, totalOrders: 0 })
    expect(r.tone).toBe('unknown')
    expect(r.decision).toBe('confirm_whatsapp')
    expect(r.reason).toContain('not a sign of fraud')
  })

  it('treats a missing score the same as no history', () => {
    expect(recommend({ riskScore: null, totalOrders: 5 }).tone).toBe('unknown')
    expect(recommend({ riskScore: undefined, totalOrders: 5 }).decision).toBe('confirm_whatsapp')
  })

  it('asks to confirm for high risk and names the score', () => {
    const r = recommend({ riskScore: 0.81, totalOrders: 10 })
    expect(r.tone).toBe('high')
    expect(r.decision).toBe('confirm_whatsapp')
    expect(r.reason).toContain('0.81')
  })

  it('asks to confirm for medium risk', () => {
    const r = recommend({ riskScore: 0.55, totalOrders: 10 })
    expect(r.tone).toBe('watch')
    expect(r.decision).toBe('confirm_whatsapp')
  })

  it('only suggests shipping a low-risk buyer with real history', () => {
    const r = recommend({ riskScore: 0.12, totalOrders: 12 })
    expect(r.tone).toBe('safe')
    expect(r.decision).toBe('ship')
    expect(r.reason).toContain('12 resolved orders')
  })

  it('flags that a low-risk verdict rests on a thin sample', () => {
    const r = recommend({ riskScore: 0.1, totalOrders: 1 })
    expect(r.reason).toContain('Only a little history')
  })

  it('does not flag a confident sample', () => {
    const r = recommend({ riskScore: 0.1, totalOrders: 5 })
    expect(r.reason).not.toContain('Only a little history')
  })
})

describe('latestByOrder', () => {
  const base: DecisionRecord = {
    id: '1',
    order_id: 'o1',
    decision: 'hold',
    actor_email: 'a@b.com',
    note: null,
    created_at: '2024-01-01T10:00:00Z',
  }

  it('keeps only the newest decision for an order', () => {
    const rows: DecisionRecord[] = [
      base,
      { ...base, id: '2', decision: 'ship', created_at: '2024-01-02T10:00:00Z' },
      { ...base, id: '3', order_id: 'o2', decision: 'call' },
    ]
    const map = latestByOrder(rows)
    expect(map.size).toBe(2)
    expect(map.get('o1')?.decision).toBe('ship')
    expect(map.get('o2')?.decision).toBe('call')
  })

  it('handles an empty list', () => {
    expect(latestByOrder([]).size).toBe(0)
  })

  it('is not confused by input order', () => {
    const rows: DecisionRecord[] = [
      { ...base, id: '2', decision: 'ship', created_at: '2024-01-02T10:00:00Z' },
      base,
    ]
    expect(latestByOrder(rows).get('o1')?.decision).toBe('ship')
  })
})

describe('needsDecision', () => {
  it('only an order with no decision needs one', () => {
    expect(needsDecision(null)).toBe(true)
    expect(needsDecision(undefined)).toBe(true)
    for (const d of DECISIONS) expect(needsDecision(d)).toBe(false)
  })
})

describe('validateDecision', () => {
  it('accepts a well-formed decision', () => {
    expect(
      validateDecision({ decision: 'hold', orderId: 'o1', actorEmail: 'a@b.com', note: 'call tomorrow' }),
    ).toBeNull()
  })

  it('rejects an unknown decision', () => {
    expect(validateDecision({ decision: 'refund', orderId: 'o1', actorEmail: 'a@b.com' })).toBe(
      'Unknown decision.',
    )
  })

  it('rejects a missing order', () => {
    expect(validateDecision({ decision: 'hold', orderId: '', actorEmail: 'a@b.com' })).toBe(
      'Missing order.',
    )
  })

  it('requires a signed-in actor', () => {
    expect(validateDecision({ decision: 'hold', orderId: 'o1', actorEmail: null })).toBe(
      'You need to be signed in to record a decision.',
    )
  })

  it('rejects an over-long note', () => {
    expect(
      validateDecision({ decision: 'hold', orderId: 'o1', actorEmail: 'a@b.com', note: 'x'.repeat(501) }),
    ).toContain('500 characters')
  })

  it('allows a missing note', () => {
    expect(validateDecision({ decision: 'hold', orderId: 'o1', actorEmail: 'a@b.com' })).toBeNull()
  })
})
