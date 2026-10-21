/** Pure helpers for normalizing courier reports and mapping their delivery states. */
export type CourierOutcome = 'accepted' | 'refused' | 'pending' | null

export interface CourierRow {
  line: number
  reference: string
  trackingNumber: string
  phone: string
  store: string
  status: string
  reason: string
  codAmount: number | null
  resolvedAt: string | null
}

function key(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

const ALIASES: Record<string, keyof Omit<CourierRow, 'line'>> = {
  orderid: 'reference', orderreference: 'reference', orderref: 'reference', merchantorderid: 'reference',
  shopifyordernumber: 'reference', ordernumber: 'reference',
  cn: 'trackingNumber', cnno: 'trackingNumber', cnnumber: 'trackingNumber', tracking: 'trackingNumber',
  trackingid: 'trackingNumber', trackingnumber: 'trackingNumber', consignmentno: 'trackingNumber',
  consignmentnumber: 'trackingNumber', shipmentid: 'trackingNumber', waybill: 'trackingNumber',
  phone: 'phone', buyerphone: 'phone', customerphone: 'phone', contact: 'phone', consigneephone: 'phone',
  consigneemobile: 'phone', mobileno: 'phone', mobilenumber: 'phone', receiverphone: 'phone',
  store: 'store', storename: 'store', shippername: 'store', merchant: 'store', vendor: 'store',
  status: 'status', currentstatus: 'status', shipmentstatus: 'status', deliverystatus: 'status',
  deliveryresult: 'status', orderstatus: 'status', outcome: 'status',
  reason: 'reason', undeliveredreason: 'reason', comments: 'reason', remarks: 'reason', returnreason: 'reason',
  codamount: 'codAmount', codamountpkr: 'codAmount', collectableamount: 'codAmount', amount: 'codAmount',
  deliveryreturndate: 'resolvedAt', statusdate: 'resolvedAt', lastactivitydate: 'resolvedAt', deliveredat: 'resolvedAt',
}

export function parseCourierRows(headers: string[], rows: unknown[][], mappedColumns: Partial<Record<keyof Omit<CourierRow, 'line'>, string>> = {}): CourierRow[] {
  const columns = new Map<string, number>()
  headers.forEach((header, i) => {
    const field = ALIASES[key(header)]
    if (!field) return
    // Prefer an explicitly customer/consignee phone over a generic Contact field.
    if (field === 'phone' && /consignee|customer|buyer|receiver|shipping/i.test(header)) columns.set(field, i)
    else if (!columns.has(field)) columns.set(field, i)
  })
  const byHeader = new Map(headers.map((header, i) => [key(header), i]))
  for (const [field, header] of Object.entries(mappedColumns)) {
    const index = byHeader.get(key(header))
    if (index !== undefined) columns.set(field as keyof Omit<CourierRow, 'line'>, index)
  }
  const get = (row: unknown[], field: keyof Omit<CourierRow, 'line'>) => {
    const i = columns.get(field)
    return i === undefined ? '' : String(row[i] ?? '').trim()
  }
  return rows.map((row, index) => {
    const amountText = get(row, 'codAmount').replace(/[^0-9.-]/g, '')
    const amount = amountText ? Number(amountText) : NaN
    const dateText = get(row, 'resolvedAt')
    const parsedDate = dateText ? new Date(dateText) : null
    return {
      line: index + 2,
      reference: get(row, 'reference').replace(/^#\s*/, ''),
      trackingNumber: get(row, 'trackingNumber'),
      phone: get(row, 'phone'),
      store: get(row, 'store'),
      status: get(row, 'status'),
      reason: get(row, 'reason'),
      codAmount: Number.isFinite(amount) ? amount : null,
      resolvedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
    }
  }).filter((r) => r.reference || r.trackingNumber || r.phone || r.status)
}

export function normalizeCourierPhone(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  // Pakistan local 03xx numbers and +923xx numbers should compare equally.
  if (digits.startsWith('92') && digits.length >= 12) return digits.slice(-10)
  if (digits.startsWith('0') && digits.length >= 11) return digits.slice(-10)
  return digits.length >= 10 ? digits.slice(-10) : digits
}

export function normalizeCourierReference(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/^#\s*/, '').replace(/[^a-z0-9]/g, '')
}

/** Only final, confident delivery states are applied automatically. */
export function courierOutcome(status: string, reason = ''): CourierOutcome {
  const s = `${status} ${reason}`.trim().toLowerCase().replace(/[_-]+/g, ' ')
  if (!s) return null
  if (/\b(delivered|successfully delivered|delivered to consignee|received by customer)\b/.test(s)) return 'accepted'
  if (/\b(customer refused|refused to receive|refused|rto|returned to shipper|returned to origin|return to origin|returned to sender|undeliverable)\b/.test(s)) return 'refused'
  // Generic UnDelivered, attempted, moved to branch, and in-transit states are not final.
  return 'pending'
}
