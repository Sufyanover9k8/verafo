import { describe, expect, it } from 'vitest'
import { parseOrderCsv, toIso } from './order-csv'

/** The header line of a real Shopify orders export, verbatim (79 columns). */
const SHOPIFY_HEADER =
  'Name,Email,Financial Status,Paid at,Fulfillment Status,Fulfilled at,Accepts Marketing,Currency,Subtotal,Shipping,Taxes,Total,Discount Code,Discount Amount,Shipping Method,Created at,Lineitem quantity,Lineitem name,Lineitem price,Lineitem compare at price,Lineitem sku,Lineitem requires shipping,Lineitem taxable,Lineitem fulfillment status,Billing Name,Billing Street,Billing Address1,Billing Address2,Billing Company,Billing City,Billing Zip,Billing Province,Billing Country,Billing Phone,Shipping Name,Shipping Street,Shipping Address1,Shipping Address2,Shipping Company,Shipping City,Shipping Zip,Shipping Province,Shipping Country,Shipping Phone,Notes,Note Attributes,Cancelled at,Payment Method,Payment Reference,Refunded Amount,Vendor,Outstanding Balance,Employee,Location,Device ID,Id,Tags,Risk Level,Source,Lineitem discount,Tax 1 Name,Tax 1 Value,Tax 2 Name,Tax 2 Value,Tax 3 Name,Tax 3 Value,Tax 4 Name,Tax 4 Value,Tax 5 Name,Tax 5 Value,Phone,Receipt Number,Duties,Billing Province Name,Shipping Province Name,Payment ID,Payment Terms Name,Next Payment Due At,Payment References'

/**
 * A row shaped exactly like Shopify writes one, including the detail that
 * matters most here: the shipping address is quoted because it contains
 * commas, so a naive split on "," would shift every later column.
 */
function shopifyRow(over: Partial<Record<string, string>> = {}): string {
  const c: Record<string, string> = {
    Name: '#SC1010',
    Email: 'naumanshiraz58@gmail.com',
    'Financial Status': 'pending',
    'Fulfillment Status': 'unfulfilled',
    'Fulfilled at': '',
    'Created at': '2026-07-18 22:41:37 +0500',
    'Lineitem quantity': '1',
    'Lineitem name': 'Sanicore Premium Square Rain Shower Head',
    'Lineitem price': '3150.00',
    Total: '3430.00',
    'Billing City': 'Mirpur',
    'Shipping City': 'Mirpur',
    'Shipping Address1': 'Manager Mcb Islamic Branch Dadyal, District Mirpur',
    'Shipping Phone': '03445974567',
    'Billing Phone': '03445974567',
    Vendor: 'Sanicore',
    'Cancelled at': '',
    ...over,
  }
  return SHOPIFY_HEADER.split(',')
    .map((h) => {
      const v = c[h] ?? ''
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    })
    .join(',')
}

describe('parseOrderCsv — a Shopify export, unmodified', () => {
  it('reads the format from the header alone', () => {
    const r = parseOrderCsv(`${SHOPIFY_HEADER}\n${shopifyRow()}`)
    expect(r.format).toBe('shopify')
    expect(r.errors).toEqual([])
  })

  it('maps the customer, product and address onto Verafo fields', () => {
    const r = parseOrderCsv(`${SHOPIFY_HEADER}\n${shopifyRow()}`)
    expect(r.orders).toHaveLength(1)
    const o = r.orders[0]
    expect(o.reference).toBe('SC1010')
    expect(o.phone).toBe('03445974567')
    expect(o.product).toBe('Sanicore Premium Square Rain Shower Head')
    expect(o.store).toBe('Sanicore')
    // Line price x quantity, so the figure is the order's value.
    expect(o.price).toBe(3150)
    expect(o.quantity).toBe(1)
    expect(o.city).toBe('Mirpur')
    expect(o.address).toBe('Manager Mcb Islamic Branch Dadyal, District Mirpur')
    expect(o.ordered_at).toBe(toIso('2026-07-18 22:41:37 +0500'))
    expect(o.outcome).toBe('pending')
  })

  it('folds several line items of one order into a single order', () => {
    const rows = [
      shopifyRow({ 'Lineitem name': 'Shower Head', 'Lineitem price': '3150.00', 'Lineitem quantity': '1' }),
      shopifyRow({ 'Lineitem name': 'Muslim Shower Set', 'Lineitem price': '1950.00', 'Lineitem quantity': '2' }),
    ]
    const r = parseOrderCsv(`${SHOPIFY_HEADER}\n${rows.join('\n')}`)
    // Three rows sharing a Name must not become three orders.
    expect(r.orders).toHaveLength(1)
    const o = r.orders[0]
    expect(o.lineItems).toBe(2)
    expect(o.product).toBe('Shower Head · Muslim Shower Set')
    expect(o.price).toBe(3150 + 1950 * 2)
    expect(o.quantity).toBe(3)
  })

  it('keeps interleaved orders apart', () => {
    const rows = [
      shopifyRow({ Name: '#A', 'Lineitem name': 'First' }),
      shopifyRow({ Name: '#B', 'Lineitem name': 'Other' }),
      shopifyRow({ Name: '#A', 'Lineitem name': 'Second' }),
    ]
    const r = parseOrderCsv(`${SHOPIFY_HEADER}\n${rows.join('\n')}`)
    expect(r.orders).toHaveLength(2)
    expect(r.orders.map((o) => o.reference)).toEqual(['A', 'B'])
    expect(r.orders[0].product).toBe('First · Second')
    expect(r.orders[1].product).toBe('Other')
  })

  it('imports Shopify rows as unknown — Fulfilled is not a delivery (SOP §4)', () => {
    const r = parseOrderCsv(
      [
        SHOPIFY_HEADER,
        shopifyRow({ Name: '#C', 'Cancelled at': '2026-07-20 10:00:00 +0500' }),
        shopifyRow({ Name: '#F', 'Fulfilled at': '2026-07-21 11:30:00 +0500', 'Fulfillment Status': 'fulfilled' }),
        shopifyRow({ Name: '#P' }),
      ].join('\n'),
    )
    const byRef = new Map(r.orders.map((o) => [o.reference, o]))
    // Fulfilled means the parcel left the warehouse. Cancelled usually means the
    // seller cancelled. Neither is what happened at the buyer's door, so neither
    // becomes an outcome — the courier file supplies that.
    expect(byRef.get('C')?.outcome).toBe('pending')
    expect(byRef.get('C')?.resolved_at).toBeNull()
    expect(byRef.get('F')?.outcome).toBe('pending')
    expect(byRef.get('F')?.resolved_at).toBeNull()
    expect(byRef.get('P')?.outcome).toBe('pending')
  })

  it('counts rows with no phone instead of failing the whole file', () => {
    const r = parseOrderCsv(
      [SHOPIFY_HEADER, shopifyRow({ Name: '#N', 'Shipping Phone': '', 'Billing Phone': '' }), shopifyRow({ Name: '#Y' })].join('\n'),
    )
    expect(r.orders).toHaveLength(1)
    expect(r.skipped).toBe(1)
  })

  it('falls back to the billing phone when there is no shipping phone', () => {
    const r = parseOrderCsv(`${SHOPIFY_HEADER}\n${shopifyRow({ 'Shipping Phone': '', 'Billing Phone': '03216664289' })}`)
    expect(r.orders[0].phone).toBe('03216664289')
  })

  it('explains a Shopify export with no phone column at all', () => {
    const noPhone = SHOPIFY_HEADER.split(',').filter((h) => h !== 'Shipping Phone' && h !== 'Billing Phone' && h !== 'Phone').join(',')
    const r = parseOrderCsv(`${noPhone}\n#X,someone@example.com`)
    expect(r.orders).toEqual([])
    expect(r.errors[0]).toContain('no phone column')
  })
})

describe('parseOrderCsv — the real 79-column Shopify export', () => {
  /*
   * A verbatim slice of a merchant's Shopify orders export: the true header,
   * and real rows carrying the awkward bits that broke earlier attempts —
   * a space before the timezone offset, quotes around an address containing
   * commas, a "|" inside product names, a product name ending in a period,
   * and a multi-line-item order whose SECOND row repeats no customer details.
   */
  const REAL = [
    SHOPIFY_HEADER,
    '#SC1010,naumanshiraz58@gmail.com,pending,,unfulfilled,,no,PKR,3150.00,280.00,0.00,3430.00,"",0.00,Express COD,2026-07-18 22:41:37 +0500,1,Sanicore™ Premium Square Rain Shower Head | SUS 304 Stainless Steel - 8x8,3150.00,,,true,true,pending,nauman shiraz,"Manager Mcb Islamic Branch Dadyal Tehsil Dadyal District Mirpur Ak","Manager Mcb Islamic Branch Dadyal Tehsil Dadyal District Mirpur Ak",,,Mirpur,\'10530,,PK,03445974567,nauman shiraz,"Manager Mcb Islamic Branch Dadyal Tehsil Dadyal District Mirpur Ak","Manager Mcb Islamic Branch Dadyal Tehsil Dadyal District Mirpur Ak",,,Mirpur,\'10530,,PK,03445974567,,"",,Cash on Delivery (COD),"",0.00,Sanicore,3430.00,,,,7373786120470,"",Low,web,0.00,,,,,,,,,,,,,,,,rAaBpIfU3lXqn8U5rViWwXy0N,,,rAaBpIfU3lXqn8U5rViWwXy0N',
    '#SC1025,m@example.com,pending,,unfulfilled,,no,PKR,2450.00,280.00,0.00,2730.00,"",0.00,Express COD,2026-10-13 09:50:06 +0500,1,304 Stainless Steel Muslim Shower Set.,2450.00,,,true,false,pending,M X,"Street 1, Karachi","Street 1, Karachi",,,Karachi,,,PK,03212776031,M X,"Street 1, Karachi","Street 1, Karachi",,,Karachi,,,PK,03212776031,,"",,Cash on Delivery (COD),"",0.00,Sanicore,2730.00,,,,111,"",Low,web,0.00,,,,,,,,,,,,,,,,abc,,,abc',
    // The continuation row, exactly as Shopify writes it: same order number,
    // and no customer block at all — blank from Billing Name through Device ID
    // (fields 25–55, one-based), which is where a multi-item order's phone and
    // city disappear. Built by joining fields so the count cannot drift.
    [
      '#SC1025', 'm@example.com', 'pending', '', 'unfulfilled', '', 'no', 'PKR',
      '7700.00', '280.00', '0.00', '7980.00', '', '0.00', 'Express COD',
      '2026-10-13 09:50:06 +0500', '2', 'Square Rain Shower Head', '3850.00', '', '',
      'true', 'true', 'unfulfilled',
      ...Array(31).fill(''), // Billing Name … Device ID, all blank
      '', '', '0.00', 'Sanicore', '7980.00', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    ].join(','),
  ].join('\n')

  it('reads every real row into the right field', () => {
    const r = parseOrderCsv(REAL)
    expect(r.format).toBe('shopify')
    expect(r.errors).toEqual([])

    // Two rows share #SC1025, so the file holds two orders, not three.
    expect(r.orders).toHaveLength(2)

    const first = r.orders[0]
    expect(first.reference).toBe('SC1010')
    expect(first.phone).toBe('03445974567')
    expect(first.city).toBe('Mirpur')
    expect(first.address).toBe('Manager Mcb Islamic Branch Dadyal Tehsil Dadyal District Mirpur Ak')
    expect(first.product).toBe('Sanicore™ Premium Square Rain Shower Head | SUS 304 Stainless Steel - 8x8')
    expect(first.price).toBe(3150)
    expect(first.store).toBe('Sanicore')
    // "2026-07-18 22:41:37 +0500" really is 17:41:37Z.
    expect(first.ordered_at).toBe('2026-07-18T17:41:37.000Z')
    expect(first.outcome).toBe('pending')
  })

  it('turns the real 17 rows into one order per order, not per row', () => {
    const r = parseOrderCsv(REAL)
    // Row 3 shares SC1025's number but repeats no phone, so it is skipped —
    // exactly what the real export does with its four continuation rows. The
    // order itself survives, with the customer block from its first row.
    expect(r.orders.map((o) => o.reference)).toEqual(['SC1010', 'SC1025'])
    expect(r.skipped).toBe(1)
    const second = r.orders[1]
    expect(second.phone).toBe('03212776031')
    expect(second.city).toBe('Karachi')
    expect(second.address).toBe('Street 1, Karachi')
  })

  it('does not treat a product name ending in a period as a new column', () => {
    // "Set." must not shift later columns the way a mis-split header would.
    const r = parseOrderCsv(REAL)
    expect(r.orders.some((o) => o.product.includes('Muslim Shower Set.'))).toBe(true)
  })
})

describe('parseOrderCsv — Verafo\'s own template still works', () => {
  const TEMPLATE = [
    'phone,store,category,product,price,quantity,address,city,ordered_at,outcome,resolved_at',
    '+923001112222,Sanicore,skincare,Vitamin C serum 30ml,2499,1,House 12 Block B Model Town,Lahore,2026-07-01 14:30,refused,2026-07-03 10:00',
    '+923214445555,Urban Threads,clothing,Cotton t-shirt,1199,2,PECHS Block 2,Karachi,2026-07-05 18:00,accepted,2026-07-06 12:00',
  ].join('\n')

  it('parses one order per row', () => {
    const r = parseOrderCsv(TEMPLATE)
    expect(r.format).toBe('verafo')
    expect(r.orders).toHaveLength(2)
    expect(r.orders[0].phone).toBe('+923001112222')
    expect(r.orders[0].store).toBe('Sanicore')
    expect(r.orders[0].outcome).toBe('refused')
    expect(r.orders[1].quantity).toBe(2)
  })
})

describe("parseOrderCsv — a file mapped by AI (stranger's spreadsheet)", () => {
  /*
   * The columns a real courier/agency sheet uses. Nothing here matches the alias
   * table: "Ship To Mobile", "Item Description", "Amount Collected", and a
   * status column whose words are the merchant's, not ours.
   */
  const STRANGE = [
    'Order Ref,Ship To Mobile,Item Description,Amount Collected,Qty,Delivery Status,Town,Ship Date',
    'A-1001,0300 1234567,Lawn suit 3pc,4999,1,Delivered,Lahore,2026-07-02 11:00',
    'A-1002,+92 321 4445555,Cotton kurta,2199,2,RTO - customer refused,Karachi,2026-07-03 09:30',
    'A-1003,0321 7778888,Silk dupatta,1499,1,In transit,Multan,2026-07-04 16:15',
  ].join('\n')

  const MAP = {
    columns: {
      phone: 'Ship To Mobile',
      product: 'Item Description',
      price: 'Amount Collected',
      quantity: 'Qty',
      city: 'Town',
      ordered_at: 'Ship Date',
      outcome: 'Delivery Status',
      reference: 'Order Ref',
    },
    status: {
      delivered: 'accepted' as const,
      'rto - customer refused': 'refused' as const,
      'in transit': 'pending' as const,
    },
  }

  it('is unreadable without the map — this is the case the AI reader exists for', () => {
    const r = parseOrderCsv(STRANGE)
    expect(r.orders).toHaveLength(0)
    expect(r.format).toBeNull()
  })

  it('reads every row once a mapping is supplied', () => {
    const r = parseOrderCsv(STRANGE, MAP)
    expect(r.orders).toHaveLength(3)
    // 0300… is kept in the spelling the file used, exactly as everywhere else in
    // the importer: Verafo matches phones by their last ten digits, and rewriting
    // the spelling here is what used to create duplicate buyers.
    expect(r.orders[0].phone).toBe('03001234567')
    expect(r.orders[0].product).toBe('Lawn suit 3pc')
    expect(r.orders[0].price).toBe(4999)
    expect(r.orders[0].city).toBe('Lahore')
    expect(r.orders[0].ordered_at?.slice(0, 10)).toBe('2026-07-02')
    expect(r.orders[0].reference).toBe('A-1001')
  })

  it('translates the file\'s own status words into outcomes', () => {
    const r = parseOrderCsv(STRANGE, MAP)
    expect(r.orders[0].outcome).toBe('accepted')
    expect(r.orders[1].outcome).toBe('refused')
    expect(r.orders[2].outcome).toBe('pending')
    // Quantity multiplies the line amount, as everywhere else in the importer.
    expect(r.orders[1].price).toBe(2199 * 2)
  })

  it('ignores a mapping entry that names a column the file does not have', () => {
    const r = parseOrderCsv(STRANGE, {
      columns: { ...MAP.columns, address: 'Home Address' },
      status: MAP.status,
    })
    expect(r.orders).toHaveLength(3)
    expect(r.orders[0].address).toBe('')
  })

  it('falls back to the built-in vocabulary for a word the mapping never saw', () => {
    const r = parseOrderCsv(STRANGE, { columns: MAP.columns, status: {} })
    // "delivered" is in the parser's own word list too, so an empty mapping still
    // reads it correctly...
    expect(r.orders[0].outcome).toBe('accepted')
    // ...and "rto - customer refused" is refused by the word list as well. A word
    // neither knows would leave the outcome unset rather than invent one.
    expect(r.orders[1].outcome).toBe('refused')
    expect(r.orders[2].outcome).toBe('pending')
  })
})

describe('toIso', () => {
  it('reads Shopify\'s timestamps, offset and all', () => {
    // 22:41:37 +0500 is 17:41:37Z
    expect(toIso('2026-07-18 22:41:37 +0500')).toBe('2026-07-18T17:41:37.000Z')
  })
  it('still reads the forms the old template used', () => {
    expect(toIso('2026-07-01 14:30')).not.toBeNull()
    expect(toIso('2026-07-01T14:30:00Z')).toBe('2026-07-01T14:30:00.000Z')
    expect(toIso('')).toBeNull()
    expect(toIso('not a date')).toBeNull()
  })
})
