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
    // Pakistani couriers use "UnDelivered" for a shipment that came back.
    expect(courierOutcome('UnDelivered', 'CUSTOMER NOT AVAILABLE')).toBe('refused')
    expect(courierOutcome('Undelivered - Attempted')).toBe('refused')
    // Still on the road or in a branch: no outcome yet.
    expect(courierOutcome('MOVED to ORIGIN BRANCH')).toBe('pending')
    expect(courierOutcome('Out for Delivery')).toBe('pending')
    expect(courierOutcome('In Transit')).toBe('pending')
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

  it('plans a realistic courier report end to end', () => {
    // A TCS-style export: two final rows, one still in transit, one undelivered.
    const headers = ['Order Ref', 'CN Number', 'Consignee Contact', 'Remarks', 'Delivery Date']
    const rows = [
      ['#1001', 'TCS0001', '0300 1112222', 'Delivered', '2026-11-10'],
      ['#1002', 'TCS0002', '0300 3334444', 'Customer Refused', '2026-11-10'],
      ['#1003', 'TCS0003', '0300 5556666', 'In Transit', ''],
      ['#1004', 'TCS0004', '0300 7778888', 'Undelivered - Attempted', ''],
    ]
    const parsed = parseCourierRows(headers, rows)
    expect(parsed).toHaveLength(4)
    expect(parsed[0].reference).toBe('1001') // leading # stripped
    expect(parsed[0].trackingNumber).toBe('TCS0001')
    expect(parsed[0].resolvedAt).toMatch(/^2026-11-10/)

    const actions = parsed.map((row) =>
      courierUpdateAction(courierOutcome(row.status, row.reason), null),
    )
    // Delivered → accepted, refused → refused, in transit → hold, UnDelivered → refused.
    expect(actions).toEqual(['update', 'update', 'hold', 'update'])
  })

  it('maps a courier report through AI-chosen columns', () => {
    // Headers a vendor actually shipped: no aliases match, so only the AI map
    // can rescue them.
    const headers = ['Vendor', 'Consignee Contact', 'CN Number', 'Remarks', 'Delivery Date']
    const aiMapping = {
      store: 'Vendor',
      phone: 'Consignee Contact',
      trackingNumber: 'CN Number',
      reason: 'Remarks',
      resolvedAt: 'Delivery Date',
    }
    const parsed = parseCourierRows(
      headers,
      [['Sanicore', '0300 1112222', 'TCS9999', 'Delivered', '2026-11-11']],
      aiMapping,
    )
    expect(parsed[0].store).toBe('Sanicore')
    expect(parsed[0].trackingNumber).toBe('TCS9999')
    expect(parsed[0].reason).toBe('Delivered')
    expect(courierOutcome(parsed[0].status, parsed[0].reason)).toBe('accepted')
  })
})
