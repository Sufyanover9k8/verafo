import { describe, expect, it } from 'vitest'
import {
  buildSegments,
  buildPassport,
  canExportAudience,
  exportAudienceCsv,
  refusalRateOf,
  daysSince,
  SEGMENTS,
  AUDIENCE_EXPORT_COLUMNS,
  type AudienceBuyer,
} from './audiences'

const b = (over: Partial<AudienceBuyer> = {}): AudienceBuyer => ({
  phone: '03001234567',
  risk_score: 0.1,
  total_orders: 5,
  total_accepted: 5,
  total_refused: 0,
  spend: 1000,
  ...over,
})

/* ─────────────────────────────────────────────────────────────
   Cross-merchant isolation. The most important tests in this file.
   ───────────────────────────────────────────────────────────── */

describe('SAFETY: cross-merchant isolation on export', () => {
  it('refuses a merchant with no store selected, because that means the network', () => {
    const d = canExportAudience({ isAdmin: false, hasStoreScope: false, rowCount: 50 })
    expect(d.allowed).toBe(false)
    expect(d.reason).toContain('not yours')
  })

  it('allows a merchant exporting their own store', () => {
    expect(canExportAudience({ isAdmin: false, hasStoreScope: true, rowCount: 12 }).allowed).toBe(true)
  })

  it('allows an admin to export the network', () => {
    expect(canExportAudience({ isAdmin: true, hasStoreScope: false, rowCount: 500 }).allowed).toBe(true)
  })

  it('refuses everyone when there is nothing to export', () => {
    expect(canExportAudience({ isAdmin: true, hasStoreScope: true, rowCount: 0 }).allowed).toBe(false)
    expect(canExportAudience({ isAdmin: false, hasStoreScope: true, rowCount: 0 }).allowed).toBe(false)
    expect(canExportAudience({ isAdmin: false, hasStoreScope: true, rowCount: 0 }).reason).toBe(
      'Nothing to export.',
    )
  })

  it('produces no CSV at all when the decision refuses', () => {
    const out = exportAudienceCsv([b()], { allowed: false, reason: 'not allowed' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('not allowed')
  })

  it('never exports a phone number that cannot be trusted, and never invents one', () => {
    const out = exportAudienceCsv([b({ phone: 'garbage' })], { allowed: true, reason: '' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.csv).toContain('garbage') // left as recorded, not fabricated
  })

  it('writes a trustworthy number in clean international form', () => {
    const out = exportAudienceCsv([b({ phone: '0300 1234567' })], { allowed: true, reason: '' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.csv).toContain('+923001234567')
  })

  it('exports only the authorized columns, never an embedding or feature vector', () => {
    const out = exportAudienceCsv([b()], { allowed: true, reason: '' })
    expect(out.ok).toBe(true)
    if (out.ok) {
      const header = out.csv.split('\r\n')[0]
      for (const col of AUDIENCE_EXPORT_COLUMNS) expect(header).toContain(`"${col}"`)
      expect(header).not.toMatch(/embedding|feature_vector/i)
    }
  })

  it('escapes a value that could run as a spreadsheet formula', () => {
    const out = exportAudienceCsv([b({ phone: '=cmd()' })], { allowed: true, reason: '' })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.csv).toContain("\"'=cmd()\"")
  })
})

/* ───────────────────────────────────────────────────────────── */

describe('refusalRateOf', () => {
  it('computes the rate over resolved orders', () => {
    expect(refusalRateOf(b({ total_accepted: 3, total_refused: 1 }))).toBeCloseTo(0.25, 5)
  })

  it('returns null when nothing has resolved, rather than zero', () => {
    expect(refusalRateOf(b({ total_accepted: 0, total_refused: 0 }))).toBeNull()
    expect(refusalRateOf(b({ total_accepted: null, total_refused: null }))).toBeNull()
  })
})

describe('daysSince', () => {
  const now = Date.parse('2024-06-01T00:00:00Z')
  it('counts whole days', () => {
    expect(daysSince({ phone: 'x', first_seen: '2024-05-01T00:00:00Z' }, now)).toBe(31)
  })
  it('returns null when there is no usable date', () => {
    expect(daysSince({ phone: 'x', first_seen: null }, now)).toBeNull()
    expect(daysSince({ phone: 'x', first_seen: 'not-a-date' }, now)).toBeNull()
  })
})

describe('buildSegments', () => {
  const now = Date.parse('2024-06-01T00:00:00Z')

  it('puts a reliable repeat buyer in the repeat segment', () => {
    const segs = buildSegments([b({ total_orders: 6, total_accepted: 6, total_refused: 0 })], now)
    expect(segs.repeat).toHaveLength(1)
  })

  it('keeps a buyer with a bad rate out of the repeat segment', () => {
    const segs = buildSegments([b({ total_orders: 6, total_accepted: 2, total_refused: 4 })], now)
    expect(segs.repeat).toHaveLength(0)
  })

  it('treats thin history as its own segment, and says it is not a risk finding', () => {
    const segs = buildSegments([b({ total_orders: 1, total_accepted: 1, total_refused: 0 })], now)
    expect(segs.thin).toHaveLength(1)
    expect(SEGMENTS.find((s) => s.key === 'thin')?.meaning).toContain('not a risk finding')
  })

  it('never places a buyer with no score into a risk segment', () => {
    const segs = buildSegments([b({ risk_score: null })], now)
    expect(segs.confirm).toHaveLength(0)
  })

  it('never places a buyer with a non-numeric score into a risk segment', () => {
    const segs = buildSegments([b({ risk_score: Number.NaN })], now)
    expect(segs.confirm).toHaveLength(0)
  })

  it('flags lapsed buyers by their own last-seen date', () => {
    const segs = buildSegments([b({ first_seen: '2024-01-01T00:00:00Z' })], now)
    expect(segs.lapsed).toHaveLength(1)
    expect(SEGMENTS.find((s) => s.key === 'lapsed')?.meaning).toContain('not to avoid')
  })

  it('does not flag a recent buyer as lapsed', () => {
    expect(buildSegments([b({ first_seen: '2024-05-30T00:00:00Z' })], now).lapsed).toHaveLength(0)
  })

  it('does not crash or invent on completely empty data', () => {
    const segs = buildSegments([], now)
    for (const s of SEGMENTS) expect(segs[s.key]).toEqual([])
  })

  it('handles buyers with every field missing', () => {
    const segs = buildSegments(
      [{ phone: '03001234567', risk_score: null, total_orders: null, total_accepted: null, total_refused: null }],
      now,
    )
    expect(segs.thin).toHaveLength(1)
    expect(segs.confirm).toHaveLength(0)
    expect(segs.repeat).toHaveLength(0)
    expect(segs.lapsed).toHaveLength(0)
  })

  it('sorts each segment by its own most useful measure', () => {
    const segs = buildSegments(
      [b({ phone: 'a', total_orders: 4 }), b({ phone: 'b', total_orders: 9 })],
      now,
    )
    expect(segs.repeat.map((x) => x.phone)).toEqual(['b', 'a'])
  })
})

describe('buildPassport', () => {
  it('keeps own-store history and network counts visibly apart', () => {
    const p = buildPassport({
      ownOrders: [
        { outcome: 'accepted', value: 1000 },
        { outcome: 'refused', value: 500 },
      ],
      network: { total_orders: 12, total_accepted: 10, total_refused: 2, store_count: 4, first_seen: '2024-01-01' },
    })
    expect(p.own).toEqual({ orders: 2, accepted: 1, refused: 1, value: 1500 })
    expect(p.network?.totalOrders).toBe(12)
    expect(p.network?.storeCount).toBe(4)
    expect(p.unknown).toBe(false)
  })

  it('marks a buyer with no resolved history anywhere as unknown', () => {
    const p = buildPassport({
      ownOrders: [],
      network: { total_orders: 0, total_accepted: 0, total_refused: 0, store_count: 1 },
    })
    expect(p.unknown).toBe(true)
  })

  it('reports a null own value rather than zero when no price was recorded', () => {
    const p = buildPassport({ ownOrders: [{ outcome: 'accepted', value: null }] })
    expect(p.own.value).toBeNull()
  })

  it('has no network block at all when the lookup returned nothing', () => {
    const p = buildPassport({ ownOrders: [], network: null })
    expect(p.network).toBeNull()
    expect(p.unknown).toBe(true)
  })

  it('never invents a network block from own data', () => {
    const p = buildPassport({ ownOrders: [{ outcome: 'accepted', value: 10 }] })
    expect(p.network).toBeNull()
  })
})
