// DEV-ONLY mock of src/lib/supabase.ts, used by vite.preview.config.ts so the
// signed-in UI can be viewed with realistic fixture data and no login.
// Never imported by the real app or the production build.

// `?nodelete-merchant` combines both flags in one token, because the shell used
// to drive the browser eats a second `&`.
const asMerchant =
  typeof location !== 'undefined' &&
  (new URLSearchParams(location.search).get('as') === 'merchant' || location.search.includes('merchant'))
const EMAIL = asMerchant ? 'shop@verafo.dev' : 'demo@verafo.dev'
const USER = { id: 'u1', email: EMAIL, user_metadata: { name: asMerchant ? 'Ayesha' : 'Laveeza' } }
const SESSION = { user: USER }

// ---------- deterministic fixtures ----------
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]

export const STORES = [
  { id: 's1', name: 'Sanicore', owner_email: 'shop@verafo.dev', shopify_domain: 'sanicore.myshopify.com', category: 'skincare', contact_phone: '+923001112222', created_at: '2026-07-01T10:00:00Z' },
  { id: 's2', name: 'Urban Threads', owner_email: 'urban@verafo.dev', shopify_domain: 'urban-threads.myshopify.com', category: 'clothing', contact_phone: '+923214445555', created_at: '2026-07-04T10:00:00Z' },
  { id: 's3', name: 'Crescent Beauty', owner_email: 'crescent@verafo.dev', shopify_domain: null, category: 'beauty', contact_phone: '+923337778888', created_at: '2026-07-09T10:00:00Z' },
]
const CITIES = ['Lahore', 'Karachi', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Sialkot']
const PRODUCTS: [string, string, number][] = [
  ['skincare', 'Vitamin C Serum 30ml', 2499],
  ['skincare', 'Retinol Cream 30ml', 2699],
  ['skincare', 'Sunscreen SPF 50', 1899],
  ['clothing', 'Cotton T-Shirt', 1199],
  ['clothing', 'Kurta Set', 2199],
  ['clothing', 'Denim Jacket', 3499],
  ['electronics', 'Wireless Earbuds', 4999],
  ['electronics', 'Fast Charger 30W', 1599],
  ['footwear', 'Running Sneakers', 3999],
  ['beauty', 'Lipstick Set of 4', 1799],
]

const phones = Array.from({ length: 34 }, (_, i) => `+9230${String(10000000 + i * 271831).slice(0, 8)}`)
const buyerStats: Record<string, { total: number; acc: number; ref: number }> = {}
const now = Date.now()
const DAY = 86400000

export const ORDERS: any[] = []
for (let i = 0; i < 140; i++) {
  const phone = pick(phones)
  const [cat, name, price] = pick(PRODUCTS)
  const store = pick(STORES)
  const age = Math.floor(Math.pow(rnd(), 1.4) * 30) // more recent orders
  const ordered = new Date(now - age * DAY - Math.floor(rnd() * DAY))
  const risky = phones.indexOf(phone) % 4 === 0
  const r = rnd()
  const resolved = age > 2
  const status = !resolved ? 'pending' : r < (risky ? 0.6 : 0.14) ? 'refused' : r < 0.94 ? 'accepted' : 'pending'
  ORDERS.push({
    id: `o${i}`,
    buyer_phone: phone,
    store_id: store.id,
    product_category: cat,
    product_name: name,
    price,
    quantity: rnd() < 0.2 ? 2 : 1,
    address: `House ${Math.floor(rnd() * 90) + 1}, Block ${pick(['A', 'B', 'C'])}`,
    city: pick(CITIES),
    ordered_at: ordered.toISOString(),
    stores: { name: store.name },
    outcomes: status === 'pending' ? null : { status, resolved_at: new Date(ordered.getTime() + 2 * DAY).toISOString(), refusal_reason: null },
  })
  const b = (buyerStats[phone] ??= { total: 0, acc: 0, ref: 0 })
  if (status !== 'pending') {
    b.total++
    if (status === 'accepted') b.acc++
    else b.ref++
  }
}
export const BUYERS = phones.map((phone) => {
  const s = buyerStats[phone] ?? { total: 0, acc: 0, ref: 0 }
  const score = s.total === 0 ? 0.5 : Math.min(1, Math.max(0, s.ref / s.total + (s.total < 3 ? 0 : 0)))
  return { phone, first_seen: new Date(now - 30 * DAY).toISOString(), total_orders: s.total, total_accepted: s.acc, total_refused: s.ref, risk_score: Number(score.toFixed(3)), embedding: null, updated_at: new Date().toISOString() }
})
ORDERS.forEach((o) => {
  const b = BUYERS.find((x) => x.phone === o.buyer_phone)!
  o.buyers = { risk_score: b.risk_score, total_orders: b.total_orders, total_accepted: b.total_accepted, total_refused: b.total_refused }
})

const TABLES: Record<string, any[]> = {
  stores: STORES,
  buyers: BUYERS,
  orders: ORDERS,
  outcomes: ORDERS.filter((o) => o.outcomes).map((o) => ({ order_id: o.id, ...o.outcomes })),
  lookups: [],
  chats: [],
  chat_messages: [],
  notifications: [],
  verafo_admins: [{ email: 'demo@verafo.dev' }],
}

/*
 * A few conversations, dated so the rail's Today / Previous 7 days / Older
 * groups and the "empty chat" state are all visible in the preview.
 */
const iso = (daysAgo: number, hoursAgo = 0) =>
  new Date(now - daysAgo * DAY - hoursAgo * 3600_000).toISOString()

const SEEDED_CHATS: any[] = [
  {
    id: 'c-seed-1',
    title: 'Footwear refusals in Karachi',
    pinned: true,
    phone: null,
    created_at: iso(0, 3),
    last_message_at: iso(0, 2),
    last_message: 'Karachi is 31% of your footwear refusal risk — 9 of 29 orders came back.',
  },
  {
    id: 'c-seed-2',
    title: 'Is +923001234567 safe to ship to?',
    pinned: false,
    phone: '+923001234567',
    created_at: iso(0, 6),
    last_message_at: iso(0, 5),
    last_message: 'Two refusals out of five delivered orders. Cash on delivery only.',
  },
  {
    id: 'c-seed-3',
    title: 'Top buyers this month',
    pinned: false,
    phone: null,
    created_at: iso(3),
    last_message_at: iso(3),
    last_message: 'Your ten best buyers account for 38% of accepted revenue.',
  },
  {
    id: 'c-seed-4',
    title: 'Vitamin C Serum returns',
    pinned: false,
    phone: null,
    created_at: iso(21),
    last_message_at: iso(21),
    last_message: 'Refusals on this line fell from 12% to 6% after the size guide went up.',
  },
  { id: 'c-seed-5', title: 'New chat', pinned: false, phone: null, created_at: iso(0, 1), last_message_at: null, last_message: null },
]

const SEEDED_MESSAGES: any[] = [
  { id: 'm-seed-1', chat_id: 'c-seed-1', role: 'user', phone: null, created_at: iso(0, 3), content: 'Which cities refuse my footwear orders most?' },
  {
    id: 'm-seed-2',
    chat_id: 'c-seed-1',
    role: 'assistant',
    phone: null,
    created_at: iso(0, 2),
    content:
      'Karachi carries most of the risk.\n\n- Karachi — 9 refusals across 29 orders (31%)\n- Lahore — 4 refusals across 22 orders (18%)\n- Multan — 3 refusals across 11 orders (27%)\n\nFootwear is your most-refused category, so the two effects stack. Consider requiring a confirmation call before dispatch on Karachi footwear orders above 3,500 PKR.',
  },
  { id: 'm-seed-3', chat_id: 'c-seed-2', role: 'user', phone: '+923001234567', created_at: iso(0, 6), content: 'Analyse +923001234567 before I dispatch today.' },
  {
    id: 'm-seed-4',
    chat_id: 'c-seed-2',
    role: 'assistant',
    phone: '+923001234567',
    created_at: iso(0, 5),
    content: 'Two refusals out of five delivered orders — that is a 40% refusal rate, well above your network average of 14%.',
  },
  { id: 'm-seed-5', chat_id: 'c-seed-3', role: 'user', phone: null, created_at: iso(3), content: 'Show me my top buyers by spend.' },
  { id: 'm-seed-6', chat_id: 'c-seed-3', role: 'assistant', phone: null, created_at: iso(3), content: 'Your ten best buyers account for 38% of accepted revenue.' },
  { id: 'm-seed-7', chat_id: 'c-seed-4', role: 'user', phone: null, created_at: iso(21), content: 'Are refusals on Vitamin C Serum improving?' },
  { id: 'm-seed-8', chat_id: 'c-seed-4', role: 'assistant', phone: null, created_at: iso(21), content: 'Refusals on this line fell from 12% to 6% after the size guide went up.' },
]

TABLES.chats.push(...SEEDED_CHATS)
TABLES.chat_messages.push(...SEEDED_MESSAGES)

// `?onboard` renders the brand-new-merchant state: a store, no orders yet, so
// the first-run checklist is still on the page.
if (typeof location !== 'undefined' && location.search.includes('onboard')) {
  TABLES.orders = []
  TABLES.outcomes = []
}

// One row per recipient, exactly like the real table, so the bell's unread
// count, per-kind icon and the admin "recently sent" list all have something
// realistic to render.
TABLES.notifications.push(
  {
    id: 'n-1',
    owner_email: EMAIL,
    kind: 'daily',
    title: 'Daily report',
    body: '6 orders today · 1 refused · 2 awaiting a verdict',
    link: '/orders',
    read_at: null,
    created_at: iso(0, 2),
  },
  {
    id: 'n-2',
    owner_email: EMAIL,
    kind: 'admin',
    title: 'Risk engine upgrade tonight',
    body: 'Verafo is read-only 11pm–midnight PKT while we ship the new scoring model.',
    link: null,
    read_at: null,
    created_at: iso(0, 5),
  },
  {
    id: 'n-3',
    owner_email: EMAIL,
    kind: 'outcome',
    title: 'Outcome recorded: accepted',
    body: '+92 300 7373424',
    link: '/orders/pending',
    read_at: iso(1),
    created_at: iso(1, 4),
  },
  {
    id: 'n-4',
    owner_email: 'shop@verafo.dev',
    kind: 'admin',
    title: 'Risk engine upgrade tonight',
    body: 'Verafo is read-only 11pm–midnight PKT while we ship the new scoring model.',
    link: null,
    read_at: null,
    created_at: iso(0, 5),
  },
)

// ---------- tiny query builder ----------
type Filter = (row: any) => boolean
let autoId = 0
const IS_ADMIN = EMAIL === 'demo@verafo.dev'
function query(table: string) {
  let rows = [...(TABLES[table] ?? [])]
  const filters: Filter[] = []
  let head = false
  let count = false
  let lim = Infinity
  let single: 'one' | 'maybe' | null = null
  let order: { col: string; asc: boolean } | null = null
  let pending: any = null
  let deleting = false
  // `?nodelete` pretends the soft-delete migration has not been applied, so the
  // "not switched on yet" state can be seen without dropping a database column.
  let pretendColumnMissing = false
  const q: any = {
    select(_c?: string, o?: any) {
      if (o?.head) head = true
      if (o?.count) count = true
      if (typeof location !== 'undefined' && location.search.includes('nodelete')) {
        if (String(_c ?? '').includes('deleted_at')) pretendColumnMissing = true
      }
      // Emulate the per-user RLS policy: a merchant only ever sees their own
      // rows, an admin also sees everyone's (that is what feeds "recently sent").
      if (table === 'notifications' && !IS_ADMIN) filters.push((r) => r.owner_email === EMAIL)
      return q
    },
    eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), q),
    in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), q),
    gte: (c: string, v: any) => (filters.push((r) => r[c] >= v), q),
    lte: (c: string, v: any) => (filters.push((r) => r[c] <= v), q),
    gt: (c: string, v: any) => (filters.push((r) => r[c] > v), q),
    lt: (c: string, v: any) => (filters.push((r) => r[c] < v), q),
    ilike: (c: string, v: string) => (filters.push((r) => String(r[c] ?? '').toLowerCase().includes(v.replace(/%/g, '').toLowerCase())), q),
    is: (c: string, v: any) => (filters.push((r) => (c === 'deleted_at' ? (r.deleted_at ?? null) === v : true)), q),
    not: (c: string, _op: string, v: any) => (filters.push((r) => (c === 'deleted_at' ? (r.deleted_at ?? null) !== v : true)), q),
    or: () => q,
    order: (c: string, o?: any) => ((order = { col: c, asc: o?.ascending !== false }), q),
    limit: (n: number) => ((lim = n), q),
    range: () => q,
    /*
     * Writes are local-only, so the preview can exercise the composer and the
     * transcript. Nothing leaves the browser: there is no network here at all.
     */
    insert: (row: any) => ((pending = row), q),
    upsert: (row: any) => ((pending = row), q),
    update: (row: any) => ((pending = { ...row }), q),
    delete: () => ((deleting = true), q),
    single: () => ((single = 'one'), q),
    maybeSingle: () => ((single = 'maybe'), q),
    then(resolve: any, reject: any) {
      if (pretendColumnMissing) {
        return Promise.resolve({
          data: null,
          error: { message: 'column orders.deleted_at does not exist', code: '42703' },
          count: null,
        }).then(resolve, reject)
      }
      if (deleting) {
        const keep = (TABLES[table] ?? []).filter((r) => !filters.every((f) => f(r)))
        TABLES[table] = keep
        rows = [...keep]
        return Promise.resolve({ data: null, error: null }).then(resolve, reject)
      }
      if (pending && table === 'notifications') {
        // markAllRead(): stamp read_at on the rows the filters matched.
        const hit = (TABLES[table] ?? []).filter((r) => filters.every((f) => f(r)))
        hit.forEach((r) => Object.assign(r, pending))
        return Promise.resolve({ data: null, error: null }).then(resolve, reject)
      }
      if (pending && (table === 'chats' || table === 'chat_messages')) {
        const base = table === 'chats' ? { id: `c${++autoId}`, pinned: false, last_message: null, phone: null, created_at: new Date().toISOString(), last_message_at: new Date().toISOString() } : { id: `m${++autoId}`, created_at: new Date().toISOString(), phone: null }
        const row = { ...base, ...pending }
        TABLES[table] = [...(TABLES[table] ?? []), row]
        if (table === 'chat_messages') {
          const parent = (TABLES.chats ?? []).find((c) => c.id === pending.chat_id)
          if (parent) {
            parent.last_message = String(pending.content ?? '').slice(0, 120)
            parent.last_message_at = row.created_at
          }
        }
        return Promise.resolve(single ? { data: row, error: null } : { data: [row], error: null }).then(resolve, reject)
      }
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (order) {
        const { col, asc } = order
        out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1))
      }
      const total = out.length
      out = out.slice(0, lim)
      const res: any = single ? { data: out[0] ?? null, error: null } : head ? { data: null, error: null, count: total } : { data: out, error: null, count: count ? total : null }
      return Promise.resolve(res).then(resolve, reject)
    },
  }
  return q
}

function rpc(name: string, args: any = {}) {
  const days = args.p_days ?? 7
  if (name === 'daily_sales') {
    const out = []
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now - i * DAY)
      const key = d.toDateString()
      const list = ORDERS.filter((o) => new Date(o.ordered_at).toDateString() === key && (!args.p_store_id || o.store_id === args.p_store_id))
      out.push({ day: d.toISOString(), orders: list.length, revenue: list.reduce((s, o) => s + o.price * o.quantity, 0) })
    }
    return Promise.resolve({ data: out, error: null })
  }
  if (name === 'network_kpis') {
    const todayKey = new Date().toDateString()
    const today = ORDERS.filter((o) => new Date(o.ordered_at).toDateString() === todayKey)
    return Promise.resolve({
      data: [{ stores: STORES.length, buyers: BUYERS.length, orders: ORDERS.length, pending_orders: ORDERS.filter((o) => !o.outcomes).length, today_orders: today.length, today_revenue: today.reduce((s, o) => s + o.price * o.quantity, 0), week_revenue: 0 }],
      error: null,
    })
  }
  if (name === 'store_overview') {
    return Promise.resolve({
      data: STORES.map((s) => {
        const list = ORDERS.filter((o) => o.store_id === s.id)
        return { ...s, orders: list.length, accepted: list.filter((o) => o.outcomes?.status === 'accepted').length, refused: list.filter((o) => o.outcomes?.status === 'refused').length, pending: list.filter((o) => !o.outcomes).length, revenue: list.reduce((a, o) => a + o.price * o.quantity, 0), buyers: new Set(list.map((o) => o.buyer_phone)).size, avg_order_value: 2400, last_order_at: list[0]?.ordered_at ?? null }
      }),
      error: null,
    })
  }
  if (name === 'search_stores') return Promise.resolve({ data: STORES.map((s) => ({ id: s.id, name: s.name, shopify_domain: s.shopify_domain, last_order_at: null })), error: null })
  if (name === 'verafo_daily_digest') return Promise.resolve({ data: 0, error: null })
  if (name === 'verafo_set_orders_hidden') {
    // Hiding is a flag, exactly like the real function: no row is removed, so
    // the preview can be used to prove a hidden order is recoverable.
    const ids: string[] = args.p_ids ?? []
    let changed = 0
    for (const o of ORDERS) {
      if (!ids.includes(o.id)) continue
      o.deleted_at = args.p_hidden ? new Date().toISOString() : null
      changed++
    }
    return Promise.resolve({ data: changed, error: null })
  }
  if (name === 'verafo_send_notification') {
    if (!IS_ADMIN) return Promise.resolve({ data: null, error: { message: 'Only an administrator can send notifications' } })
    const audience: string[] = args.p_all
      ? [...new Set(STORES.map((s) => s.owner_email).concat('demo@verafo.dev'))]
      : [String(args.p_email ?? EMAIL).toLowerCase()]
    audience.forEach((owner, i) => {
      TABLES.notifications.push({
        id: `n-new-${++autoId}-${i}`,
        owner_email: owner,
        kind: 'admin',
        title: args.p_title,
        body: args.p_body ?? null,
        link: args.p_link ?? null,
        read_at: null,
        created_at: new Date().toISOString(),
      })
    })
    return Promise.resolve({ data: audience.length, error: null })
  }
  return Promise.resolve({ data: [], error: null })
}

export const isConfigured = true
// The real module exports these so src/lib/ai.ts can build request headers.
// There is no gateway in the preview, so they stay null and every AI call
// short-circuits at `functionsBaseUrl()`.
export const supabaseUrl: string | null = null
export const supabaseKey: string | null = null
export const supabase: any = {
  auth: {
    getSession: () => Promise.resolve({ data: { session: SESSION } }),
    getUser: () => Promise.resolve({ data: { user: USER } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({ error: null }),
    updateUser: () => Promise.resolve({ error: null }),
    signInWithPassword: () => Promise.resolve({ data: {}, error: null }),
    signUp: () => Promise.resolve({ data: {}, error: null }),
    resetPasswordForEmail: () => Promise.resolve({ error: null }),
  },
  from: (t: string) => query(t),
  rpc,
}
export function functionsBaseUrl(): string | null {
  /*
   * Same-origin, so the preview's stand-in `verafo-ai` (see
   * vite.preview.config.ts) answers the app's real request shape. `?ai=` on the
   * page URL picks which behaviour to simulate — normal streaming, an answer cut
   * short, a 500, or an expired session.
   */
  if (typeof location !== 'undefined') return `${location.origin}/functions/v1`
  return null
}
