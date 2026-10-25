/** Pure helpers for normalizing courier reports and mapping their delivery states. */
export type CourierOutcome = 'accepted' | 'refused' | 'pending' | null

/** The three values `outcomes.status` accepts, plus `null` for "no row yet". */
export type StoredOutcome = 'accepted' | 'refused' | 'pending' | null

/** What a courier row will do to the order it matched. */
export type CourierUpdateAction =
  /** The stored outcome differs → the merchant can write it. */
  | 'update'
  /** The database already holds exactly this outcome → nothing to write. */
  | 'already'
  /** No final courier status (In Transit, UnDelivered, …) → never written. */
  | 'hold'

/**
 * `outcomes.status` is constrained to lowercase, but a value can still arrive
 * with stray whitespace or in another casing (older rows, hand edits). Anything
 * unrecognised must read as "no outcome", not as a mismatch that triggers a
 * pointless write.
 */
export function normalizeStoredOutcome(value: unknown): StoredOutcome {
  const s = String(value ?? '').trim().toLowerCase()
  return s === 'accepted' || s === 'refused' || s === 'pending' ? s : null
}

/**
 * Decide whether a courier row is worth writing.
 *
 * This is the single place that answers "will pressing Confirm change
 * anything", so the count on the button and the write loop can never disagree:
 * a row whose stored outcome already equals the courier's outcome is *not* an
 * update, and reporting it as one is what makes the button look broken.
 */
export function courierUpdateAction(outcome: CourierOutcome, stored: StoredOutcome): CourierUpdateAction {
  if (!outcome || outcome === 'pending') return 'hold'
  return stored === outcome ? 'already' : 'update'
}

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
