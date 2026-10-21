import { describe, expect, it } from 'vitest'
import { formatPhonePK, telLink, whatsappLink, confirmOrderMessage } from './phone'

describe('formatPhonePK', () => {
  it('accepts the ways Pakistani merchants write a mobile', () => {
    const expected = {
      e164: '+923001234567',
      national: '0300 1234567',
      display: '+92 300 1234567',
      kind: 'mobile',
    }
    expect(formatPhonePK('03001234567')).toEqual(expected)
    expect(formatPhonePK('0300 123 4567')).toEqual(expected)
    expect(formatPhonePK('0300-1234567')).toEqual(expected)
    expect(formatPhonePK('3001234567')).toEqual(expected)
    expect(formatPhonePK('+923001234567')).toEqual(expected)
    expect(formatPhonePK('00923001234567')).toEqual(expected)
    expect(formatPhonePK('923001234567')).toEqual(expected)
  })

  it('offers one display form, whatever way the number arrived', () => {
    const display = '+92 321 8210110'
    // The spelling Shopify exports, a local one, and an international one.
    expect(formatPhonePK('923218210110')?.display).toBe(display)
    expect(formatPhonePK('0321 8210110')?.display).toBe(display)
    expect(formatPhonePK('+92 321 8210110')?.display).toBe(display)
  })

  it('tags a landline and keeps it usable for calls', () => {
    const p = formatPhonePK('04235678901')
    expect(p?.kind).toBe('landline')
    expect(p?.e164).toBe('+924235678901')
  })

  it('refuses numbers it cannot trust', () => {
    expect(formatPhonePK(null)).toBeNull()
    expect(formatPhonePK('')).toBeNull()
    expect(formatPhonePK('abc')).toBeNull()
    expect(formatPhonePK('12345')).toBeNull()
    expect(formatPhonePK('030012345')).toBeNull()
    expect(formatPhonePK('030012345678901')).toBeNull()
    expect(formatPhonePK('+15551234567')).toBeNull()
  })
})

describe('telLink / whatsappLink', () => {
  it('builds links for a mobile', () => {
    expect(telLink('0300 1234567')).toBe('tel:+923001234567')
    expect(whatsappLink('0300 1234567', 'Hi')).toBe('https://wa.me/923001234567?text=Hi')
  })

  it('returns null rather than a broken link', () => {
    expect(telLink('nonsense')).toBeNull()
    expect(whatsappLink('nonsense', 'Hi')).toBeNull()
    // WhatsApp cannot message a landline
    expect(whatsappLink('04235678901', 'Hi')).toBeNull()
  })

  it('encodes the message', () => {
    expect(whatsappLink('03001234567', 'a b&c')).toBe('https://wa.me/923001234567?text=a%20b%26c')
  })
})

describe('confirmOrderMessage', () => {
  it('uses only the parts it is given', () => {
    expect(
      confirmOrderMessage({ storeName: 'Luxe Skincare', amount: 8400, product: 'Serum' }),
    ).toBe('Hello, this is Luxe Skincare. Please confirm your order for Serum of 8,400 PKR. Reply YES to confirm.')
  })

  it('still reads well with the amount missing', () => {
    expect(confirmOrderMessage({ storeName: 'Luxe', product: 'Serum' })).toBe(
      'Hello, this is Luxe. Please confirm your order for Serum. Reply YES to confirm.',
    )
  })

  it('never leaves an empty hole in the sentence', () => {
    const msg = confirmOrderMessage({})
    expect(msg).toContain('this is Verafo')
    expect(msg).toContain('your order')
    expect(msg.endsWith('Reply YES to confirm.')).toBe(true)
  })
})
