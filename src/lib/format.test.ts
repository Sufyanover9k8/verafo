import { describe, expect, it } from 'vitest'
import { currency, dateOnly, dateTime, dayKey, monthKey, money, normalizePhone, phone, timeAgo } from './format'

describe('currency', () => {
  it('renders PKR with thousands separators', () => {
    expect(currency(2200)).toBe('PKR 2,200')
    expect(currency(123456)).toBe('PKR 123,456')
    expect(currency(0)).toBe('PKR 0')
  })

  it('renders em-dash for missing/invalid values', () => {
    expect(currency(null)).toBe('—')
    expect(currency(undefined)).toBe('—')
    expect(currency(Number.NaN)).toBe('—')
  })
})

describe('money', () => {
  it('renders PKR with thousands separators', () => {
    expect(money(2200)).toBe('PKR 2,200')
    expect(money(123456.5)).toBe('PKR 123,456.5')
    expect(money(null)).toBe('—')
  })
})

describe('phone', () => {
  it('groups a local number 0301 234 5678', () => {
    expect(phone('03012345678')).toBe('0301 234 5678')
  })

  it('rewrites the 92 country code to a leading 0', () => {
    expect(phone('+923012345678')).toBe('0301 234 5678')
    expect(phone('923012345678')).toBe('0301 234 5678')
  })

  it('does not rewrite a short/non-92 number', () => {
    expect(phone('301234567')).toBe('3012 345 67')
  })

  it('falls back to em-dash for empty input', () => {
    expect(phone('')).toBe('—')
    expect(phone(null)).toBe('—')
  })
})

describe('normalizePhone', () => {
  it('strips punctuation and keeps digits/plus', () => {
    expect(normalizePhone('(0301) 234-5678')).toBe('03012345678')
    expect(normalizePhone('+92 301 234 5678')).toBe('+923012345678')
  })
})

describe('dates', () => {
  it('renders em-dash for missing dates', () => {
    expect(dateTime(null)).toBe('—')
    expect(dateOnly(undefined)).toBe('—')
  })

  it('renders valid dates', () => {
    const iso = new Date('2026-01-05T12:30:00').toISOString()
    expect(dateTime(iso)).not.toBe('—')
    expect(dateTime(iso)).toContain('2026')
    expect(dateOnly(iso)).not.toBe('—')
  })

  it('dayKey and monthKey produce readable keys', () => {
    const iso = new Date('2026-01-05T12:00:00').toISOString()
    expect(dayKey(iso)).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/)
    expect(monthKey(iso)).toMatch(/^[A-Z][a-z]{2} \d{2}$/)
    expect(monthKey(null)).toBe('')
  })
})

describe('timeAgo', () => {
  it('labels recent timestamps', () => {
    expect(timeAgo(new Date(Date.now() - 10 * 1000).toISOString())).toBe('just now')
    expect(timeAgo(new Date(Date.now() - 5 * 60000).toISOString())).toBe('5m ago')
    expect(timeAgo(new Date(Date.now() - 3 * 3600000).toISOString())).toBe('3h ago')
    expect(timeAgo(new Date(Date.now() - 2 * 86400000).toISOString())).toBe('2d ago')
    expect(timeAgo(null)).toBe('')
  })
})