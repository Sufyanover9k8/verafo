import { describe, expect, it } from 'vitest'
import {
  courierOutcome,
  courierUpdateAction,
  normalizeCourierPhone,
  normalizeCourierReference,
  normalizeStoredOutcome,
  parseCourierRows,
} from './courier-reconciliation'

describe('courier reconciliation helpers', () => {
  it('recognizes the sample courier spreadsheet headers', () => {
    const headers = ['CNNo', 'Ref #', 'Name', 'Contact', 'Consignee Phone', 'Shipper Name', 'COD Amount', 'Current Status', 'Undelivered Reason', 'Order ID']
    const parsed = parseCourierRows(headers, [[
      '09757-01-010049064', '03161837436', 'Arifa Bhatti', '03000000000', '03177770716', 'SANICORE', '3900', 'Delivered', '', ''
    ]])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].trackingNumber).toBe('09757-01-010049064')
    expect(parsed[0].phone).toBe('03177770716')
    expect(parsed[0].store).toBe('SANICORE')
    expect(parsed[0].status).toBe('Delivered')
  })

  it('normalizes Pakistan local and international phone formats', () => {
    expect(normalizeCourierPhone('0333-1234567')).toBe(normalizeCourierPhone('+92 333 1234567'))
  })

  it('normalizes order references without a leading hash', () => {
    expect(normalizeCourierReference('#SC-1010')).toBe(normalizeCourierReference('SC1010'))
  })

  it('maps only clear final outcomes automatically', () => {
    expect(courierOutcome('Delivered')).toBe('accepted')
    expect(courierOutcome('Returned to shipper')).toBe('refused')
    expect(courierOutcome('UnDelivered', 'CUSTOMER NOT AVAILABLE')).toBe('pending')
    expect(courierOutcome('MOVED to ORIGIN BRANCH')).toBe('pending')
  })

  it('reads a stored outcome defensively', () => {
    expect(normalizeStoredOutcome('accepted')).toBe('accepted')
    expect(normalizeStoredOutcome(' Refused ')).toBe('refused')
    expect(normalizeStoredOutcome(null)).toBeNull()
    expect(normalizeStoredOutcome('')).toBeNull()
    expect(normalizeStoredOutcome('delivered')).toBeNull()
  })

  it('only counts a row as an update when the database would actually change', () => {
    // The exact bug from the report: the preview promised three updates, then
    // applied nothing because the stored outcome already matched the report.
    expect(courierUpdateAction('accepted', 'accepted')).toBe('already')
    expect(courierUpdateAction('refused', 'refused')).toBe('already')
    expect(courierUpdateAction('accepted', 'pending')).toBe('update')
    expect(courierUpdateAction('refused', 'accepted')).toBe('update')
    // No outcome row yet is an update, not an "already".
    expect(courierUpdateAction('accepted', null)).toBe('update')
    // Non-final courier statuses are never written, whatever is stored.
    expect(courierUpdateAction('pending', 'accepted')).toBe('hold')
    expect(courierUpdateAction(null, null)).toBe('hold')
  })
})
