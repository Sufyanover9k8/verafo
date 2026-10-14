import { describe, expect, it } from 'vitest'
import { toScored } from './insight-cards'

describe('toScored', () => {
  it('maps an accepted and a refused outcome through', () => {
    const out = toScored([
      { outcomes: { status: 'accepted' } },
      { outcomes: { status: 'refused' } },
    ])
    expect(out.map((o) => o.outcome)).toEqual(['accepted', 'refused'])
  })

  it('treats a missing outcome row as pending, never as a refusal', () => {
    const out = toScored([{ outcomes: null }, {}, { outcomes: { status: null } }])
    expect(out.map((o) => o.outcome)).toEqual(['pending', 'pending', 'pending'])
  })

  it('treats an explicit pending as pending', () => {
    expect(toScored([{ outcomes: { status: 'pending' } }])[0].outcome).toBe('pending')
  })

  it('treats an unrecognised status as pending rather than trusting it', () => {
    expect(toScored([{ outcomes: { status: 'lost_in_transit' } }])[0].outcome).toBe('pending')
  })

  it('carries the fields the analytics engine reads', () => {
    const [o] = toScored([
      {
        city: 'Lahore',
        product_name: 'Serum',
        product_category: 'skincare',
        price: 1200,
        quantity: 2,
        ordered_at: '2024-01-01T10:00:00Z',
        outcomes: { status: 'accepted' },
      },
    ])
    expect(o.city).toBe('Lahore')
    expect(o.product_name).toBe('Serum')
    expect(o.price).toBe(1200)
    expect(o.quantity).toBe(2)
    expect(o.ordered_at).toBe('2024-01-01T10:00:00Z')
  })

  it('preserves null prices so value is reported as unknown, not zero', () => {
    expect(toScored([{ price: null }])[0].price).toBeNull()
  })

  it('handles an empty list', () => {
    expect(toScored([])).toEqual([])
  })
})
