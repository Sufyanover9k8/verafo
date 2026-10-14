import { describe, expect, it } from 'vitest'
import { escapeCsvCell, toCsv } from './csv'
import { formatPKR, formatCount, sentence } from './money'

describe('escapeCsvCell', () => {
  it('quotes every value', () => {
    expect(escapeCsvCell('hello')).toBe('"hello"')
    expect(escapeCsvCell(42)).toBe('"42"')
    expect(escapeCsvCell(null)).toBe('""')
  })

  it('doubles inner quotes', () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('defuses formula injection', () => {
    expect(escapeCsvCell('=1+1')).toBe('"\'=1+1"')
    expect(escapeCsvCell('+92 300')).toBe('"\'+92 300"')
    expect(escapeCsvCell('-5')).toBe('"\'-5"')
    expect(escapeCsvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"')
    expect(escapeCsvCell('\tcmd')).toBe('"\'\tcmd"')
  })

  it('keeps commas and newlines inside the quotes', () => {
    expect(escapeCsvCell('Lahore, PK')).toBe('"Lahore, PK"')
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"')
  })
})

describe('toCsv', () => {
  it('starts with a UTF-8 BOM so Excel reads it correctly', () => {
    expect(toCsv([{ a: 1 }]).startsWith('\uFEFF')).toBe(true)
  })

  it('uses the given column order', () => {
    const out = toCsv([{ b: 2, a: 1 }], ['a', 'b'])
    expect(out).toBe('\uFEFF"a","b"\r\n"1","2"\r\n')
  })

  it('writes a header even with no rows', () => {
    expect(toCsv([], ['a', 'b'])).toBe('\uFEFF"a","b"\r\n')
  })

  it('returns an empty string when there is nothing at all', () => {
    expect(toCsv([])).toBe('')
  })

  it('protects a buyer name that starts with a formula character', () => {
    const out = toCsv([{ name: '=HYPERLINK("x")' }], ['name'])
    expect(out).toContain('"\'=HYPERLINK(""x"")"')
  })
})

describe('formatPKR / formatCount / sentence', () => {
  it('adds thousands separators', () => {
    expect(formatPKR(8400)).toBe('PKR 8,400')
    expect(formatPKR(1234567)).toBe('PKR 1,234,567')
    expect(formatPKR(0)).toBe('PKR 0')
  })

  it('shows a dash for missing numbers, never a fake zero', () => {
    expect(formatPKR(null)).toBe('—')
    expect(formatPKR(undefined)).toBe('—')
    expect(formatCount(Number.NaN)).toBe('—')
  })

  it('joins a sentence and skips the empty parts', () => {
    expect(sentence(['3 orders', null, false, 'PKR 8,400'])).toBe('3 orders · PKR 8,400')
    expect(sentence([null, undefined, false])).toBe('')
  })
})
