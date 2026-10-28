import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

/*
 * Verafo launch check.
 *
 *   PROFILE=load  k6 run scripts/load/k6-verafo.js     # steady traffic
 *   PROFILE=spike k6 run scripts/load/k6-verafo.js     # 3x jump
 *
 * Two phases, because they fail differently:
 *
 *   1. DELIVERY  always runs — the marketing page at `/`, the app shell at
 *      `/dashboard`, `/login` and one hashed asset, exactly as a merchant's
 *      browser asks for them.
 *   2. DATABASE  runs only when SUPABASE_URL + ACCESS_TOKEN (+ optional
 *      STORE_ID) are passed. It replays the dashboard's real read pattern:
 *      the 500-order page, the 5 000-row buyer scan, and the two aggregate
 *      RPCs. Those are the queries that decide whether launch day holds, and
 *      they cannot be exercised without a signed-in test account.
 *
 * When phase 2 is not configured the run still reports (see db_not_configured),
 * so a green result is never mistaken for "the database was tested".
 */

const BASE = (__ENV.BASE_URL || 'https://www.verafo.com').replace(/\/$/, '')
const SUPABASE = (__ENV.SUPABASE_URL || '').replace(/\/$/, '')
const TOKEN = __ENV.ACCESS_TOKEN || ''
const API_KEY = __ENV.API_KEY || TOKEN
const DB_ENABLED = Boolean(SUPABASE && TOKEN)
const PROFILE = (__ENV.PROFILE || 'load').toLowerCase()
const VUS = Number(__ENV.VUS || 20)

const dbLatency = new Trend('db_query_ms', true)
const dbErrors = new Rate('db_error_rate')
const dbNotConfigured = new Rate('db_not_configured')

// The two read patterns that grow with the order book, plus the two RPCs the
// dashboard calls on every visit.
const DB_CALLS = [
  { name: 'orders_page', url: `${SUPABASE}/rest/v1/orders?select=*,stores(name),outcomes(status,resolved_at)&limit=500` },
  { name: 'buyers_scan', url: `${SUPABASE}/rest/v1/buyers?select=phone,risk_score,total_orders&limit=5000` },
  { name: 'network_kpis', url: `${SUPABASE}/rest/v1/rpc/network_kpis`, method: 'POST', body: '{}' },
  { name: 'daily_sales', url: `${SUPABASE}/rest/v1/rpc/daily_sales`, method: 'POST', body: '{"p_days":30}' },
]

const thresholds = {
  http_req_failed: ['rate<0.01'],
  'http_req_duration{endpoint:site}': ['p(95)<1500', 'p(99)<3000'],
  'http_req_duration{endpoint:app_shell}': ['p(95)<1500'],
  'http_req_duration{endpoint:asset}': ['p(95)<800'],
  checks: ['rate>0.99'],
  ...(DB_ENABLED
    ? {
        'http_req_duration{endpoint:db}': ['p(95)<1200'],
        db_error_rate: ['rate<0.01'],
      }
    : {}),
}

export const options = {
  scenarios:
    PROFILE === 'spike'
      ? {
          spike: {
            executor: 'ramping-vus',
            startVUs: Math.max(1, Math.floor(VUS / 2)),
            stages: [
              { duration: '30s', target: VUS }, // warm
              { duration: '15s', target: VUS * 3 }, // sudden jump to 3x
              { duration: '1m30s', target: VUS * 3 }, // hold the peak
              { duration: '45s', target: 0 },
            ],
            gracefulRampDown: '10s',
          },
        }
      : {
          load: {
            executor: 'constant-vus',
            vus: VUS,
            duration: '3m',
            gracefulStop: '10s',
          },
        },
  thresholds,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  discardResponseBodies: false,
}

function headers() {
  return {
    authorization: `Bearer ${TOKEN}`,
    apikey: API_KEY,
    'content-type': 'application/json',
    'accept-profile': 'public',
  }
}

/** Phase 2 — the dashboard's own queries. */
function databasePhase() {
  if (!DB_ENABLED) {
    dbNotConfigured.add(1)
    return
  }
  dbNotConfigured.add(0)
  for (const call of DB_CALLS) {
    const res = http.request(call.method || 'GET', call.url, call.body, {
      headers: headers(),
      tags: { endpoint: 'db', query: call.name },
      timeout: '20s',
    })
    dbLatency.add(res.timings.duration, { query: call.name })
    const ok = res.status >= 200 && res.status < 300
    dbErrors.add(!ok, { query: call.name })
    check(res, { [`db ${call.name} 2xx`]: () => ok })
  }
}

export default function () {
  // ── phase 1: delivery ────────────────────────────────────────────────────
  const site = http.get(`${BASE}/`, { tags: { endpoint: 'site' }, timeout: '20s' })
  check(site, {
    'site 200': (r) => r.status === 200,
    'site is the marketing page': (r) => typeof r.body === 'string' && r.body.includes('how-it-works.html'),
  })

  const shell = http.get(`${BASE}/dashboard`, { tags: { endpoint: 'app_shell' }, timeout: '20s' })
  check(shell, {
    'app shell 200': (r) => r.status === 200,
    'app shell loads the SPA bundle': (r) => typeof r.body === 'string' && /\/assets\/index-[\w-]+\.js/.test(r.body),
  })

  const asset = typeof shell.body === 'string' ? (shell.body.match(/\/assets\/index-[\w-]+\.js/) || [])[0] : null
  if (asset) {
    const js = http.get(`${BASE}${asset}`, { tags: { endpoint: 'asset' }, timeout: '20s' })
    check(js, { 'app bundle 200': (r) => r.status === 200 })
  }

  const login = http.get(`${BASE}/login`, { tags: { endpoint: 'app_shell' }, timeout: '20s' })
  check(login, { 'login 200': (r) => r.status === 200 })

  databasePhase()

  sleep(1 + Math.random())
}
