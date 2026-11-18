import { describe, expect, it } from 'vitest'
import {
  failedRowsCsv,
  mapOutcome,
  parseCsv,
  parseImport,
  parseOrderDate,
  parsePrice,
  sniffDelimiter,
  stableRef,
  stripBom,
} from './import'

describe('stripBom / sniffDelimiter', () => {
  it('removes a UTF-8 BOM so the first header still matches', () => {
    expect(stripBom('\uFEFFphone,store')).toBe('phone,store')
  })

  it('keeps the BOM from breaking header detection end to end', () => {
    const r = parseImport('\uFEFFphone,store,price\n+923001234567,Sanicore,2499')
    expect(r.fileErrors).toEqual([])
    expect(r.rows[0].phone).toBe('+923001234567')
  })

  it('sniffs commas, semicolons and tabs', () => {
    expect(sniffDelimiter('phone,store')).toBe(',')
    expect(sniffDelimiter('phone;store;price')).toBe(';')
    expect(sniffDelimiter('phone\tstore\tprice')).toBe('\t')
  })

  it('ignores delimiters inside quoted headers', () => {
    expect(sniffDelimiter('"phone;number";store;price')).toBe(';')
  })
})

describe('parseCsv', () => {
  it('handles quoted fields, doubled quotes and embedded newlines', () => {
    const rows = parseCsv('a,b\n"x, y","he said ""hi"""\n"multi\nline",z')
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['multi\nline', 'z'],
    ])
  })

  it('drops blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('parses semicolon files', () => {
    expect(parseCsv('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('parsePrice', () => {
  it('reads plain numbers', () => {
    expect(parsePrice('2499')).toEqual({ value: 2499, corrected: false })
    expect(parsePrice('2499.50')).toEqual({ value: 2499.5, corrected: false })
  })

  it('reads thousands separators and currency words', () => {
    expect(parsePrice('2,499').value).toBe(2499)
    expect(parsePrice('Rs. 2,499').value).toBe(2499)
    expect(parsePrice('PKR 2499').value).toBe(2499)
    expect(parsePrice('₨ 2 499').value).toBe(2499)
  })

  it('reads European decimal commas', () => {
    expect(parsePrice('1.199,00').value).toBe(1199)
    expect(parsePrice('1,20,000').value).toBe(120000)
    expect(parsePrice('2,49').value).toBe(2.49)
  })

  it('rejects negatives and nonsense rather than guessing', () => {
    expect(parsePrice('-500').error).toBe('price cannot be negative')
    expect(parsePrice('abc').error).toMatch(/not a number/)
  })

  it('treats a blank cell as no price', () => {
    expect(parsePrice('')).toEqual({ value: null, corrected: false })
  })
})

describe('parseOrderDate', () => {
  it('reads ISO and space-separated datetimes as Pakistan time', () => {
    expect(parseOrderDate('2026-07-01 14:30').iso).toBe('2026-07-01T09:30:00.000Z')
    expect(parseOrderDate('2026-07-01').iso).toBe('2026-06-30T19:00:00.000Z')
  })

  it('respects an explicit offset', () => {
    expect(parseOrderDate('2026-07-01T14:30:00Z').iso).toBe('2026-07-01T14:30:00.000Z')
    expect(parseOrderDate('2026-07-01T14:30:00+05:00').iso).toBe('2026-07-01T09:30:00.000Z')
  })

  it('reads DD/MM/YYYY and flags the ambiguous ones', () => {
    const r = parseOrderDate('15/07/2026')
    // Midnight Pakistan time is 19:00Z the day before.
    expect(r.iso).toBe('2026-07-14T19:00:00.000Z')
    expect(r.ambiguous).toBe(false)

    const amb = parseOrderDate('07/05/2026')
    expect(amb.iso).toBe('2026-05-06T19:00:00.000Z')
    expect(amb.ambiguous).toBe(true)
  })

  it('accepts two-digit years', () => {
    expect(parseOrderDate('01/07/26').iso).toBe('2026-06-30T19:00:00.000Z')
  })

  it('errors on impossible or unknown dates instead of defaulting to now', () => {
    expect(parseOrderDate('2026-13-45').error).toBeTruthy()
    expect(parseOrderDate('31/02/2026').error).toBeTruthy()
    expect(parseOrderDate('next tuesday').error).toBeTruthy()
  })

  it('returns null for a blank cell', () => {
    expect(parseOrderDate('')).toEqual({ iso: null, ambiguous: false })
  })
})

describe('mapOutcome', () => {
  it('maps the words merchants actually use', () => {
    for (const w of ['Delivered', 'fulfilled', 'COMPLETED', 'paid']) {
      expect(mapOutcome(w)).toEqual({ status: 'accepted', known: true })
    }
    for (const w of ['Returned', 'RTO', 'Cancelled', 'refused', 'Failed']) {
      expect(mapOutcome(w)).toEqual({ status: 'refused', known: true })
    }
    for (const w of ['', 'pending', 'in transit', 'shipped']) {
      expect(mapOutcome(w)).toEqual({ status: 'pending', known: true })
    }
  })

  it('normalises underscores and dashes', () => {
    expect(mapOutcome('in_transit').status).toBe('pending')
    expect(mapOutcome('not-delivered').status).toBe('refused')
  })

  it('marks unrecognised words so the UI can warn', () => {
    expect(mapOutcome('awaiting rider')).toEqual({ status: 'pending', known: false })
  })
})

describe('stableRef', () => {
  it('is stable for the same row and changes when the row changes', () => {
    const a = stableRef(['+923001234567', '2026-07-01T09:30:00.000Z', 'Serum', 2499, 1])
    const b = stableRef(['+923001234567', '2026-07-01T09:30:00.000Z', 'Serum', 2499, 1])
    const c = stableRef(['+923001234567', '2026-07-01T09:30:00.000Z', 'Serum', 2500, 1])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('parseImport', () => {
  const csv = [
    'phone,store,product,price,quantity,ordered_at,outcome',
    '0300-1112222,Sanicore,Serum,"2,499",1,2026-07-01 14:30,Delivered',
    '+92 300 111 2222,Sanicore,Serum,"2,499",1,2026-07-01 14:30,Delivered',
    ',Sanicore,Serum,2499,1,2026-07-01,refused',
    '0321 44 55 555,Sanicore,Shirt,Rs. 1199,2,not-a-date,Returned',
    '0333 777 8888,Sanicore,Cream,2699,1,2026-07-10,awaiting rider',
  ].join('\n')

  it('canonicalises phones so one person is one buyer', () => {
    const r = parseImport(csv)
    expect(r.rows[0].phone).toBe('+923001112222')
    expect(r.rows[1].phone).toBe('+923001112222')
  })

  it('gives duplicate rows the same import ref — and unique people different ones', () => {
    const r = parseImport(csv)
    expect(r.rows[0].importRef).toBe(r.rows[1].importRef)
    expect(r.rows[0].importRef).not.toBe(r.rows[3].importRef)
  })

  it('collects row errors instead of importing bad rows', () => {
    const r = parseImport(csv)
    expect(r.rows[2].errors).toContain('missing phone')
    expect(r.rows[3].errors.join(' ')).toMatch(/not a date/)
    expect(r.counts.invalid).toBe(2)
    expect(r.counts.ready).toBe(3)
  })

  it('maps outcomes and reports unknown words', () => {
    const r = parseImport(csv)
    expect(r.rows[0].outcome).toBe('accepted')
    expect(r.rows[3].outcome).toBe('refused')
    expect(r.rows[4].outcome).toBe('pending')
    expect(r.unknownOutcomes).toEqual(['awaiting rider'])
  })

  it('flags corrected prices', () => {
    const r = parseImport(csv)
    expect(r.rows[0].price).toBe(2499)
    expect(r.counts.correctedPrices).toBeGreaterThan(0)
  })

  it('reports a missing phone column once, not per row', () => {
    const r = parseImport('store,price\nSanicore,10')
    expect(r.fileErrors[0]).toMatch(/No phone column/)
  })

  it('reads a Shopify export by its own header names', () => {
    const shopify = [
      'Name,Email,Financial Status,Lineitem quantity,Lineitem price,Shipping Phone,Created at',
      '#1001,a@b.com,paid,2,1199,+92 300 111 2222,2026-07-01 10:00',
    ].join('\n')
    const r = parseImport(shopify)
    expect(r.fileErrors).toEqual([])
    expect(r.rows[0].phone).toBe('+923001112222')
    expect(r.rows[0].quantity).toBe(2)
    expect(r.rows[0].price).toBe(1199)
    expect(r.rows[0].outcome).toBe('accepted')
  })

  it('warns when quantity is unusable', () => {
    const r = parseImport('phone,quantity\n03001112222,zero')
    expect(r.rows[0].quantity).toBe(1)
    expect(r.rows[0].warnings.join(' ')).toMatch(/quantity/)
  })

  it('returns a readable error for an empty file', () => {
    expect(parseImport('').fileErrors).toEqual(['The file is empty.'])
  })
})

describe('failedRowsCsv', () => {
  it('escapes quotes so the download is still a valid CSV', () => {
    expect(failedRowsCsv([{ line: 3, reason: 'bad "phone"' }])).toBe('line,reason\n3,"bad ""phone"""\n')
  })
})
