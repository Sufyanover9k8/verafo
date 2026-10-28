import http from 'k6/http'
import { check } from 'k6'

const BASE = (__ENV.BASE_URL || 'https://www.verafo.com').replace(/\/$/, '')

export const options = {
  vus: 5,
  duration: '15s',
  summaryTrendStats: ['avg', 'p(95)'],
}

export default function () {
  for (const path of ['/', '/dashboard', '/styles.css']) {
    const res = http.get(`${BASE}${path}`, { timeout: '20s' })
    // One check name per (path, status) so the summary prints the real codes.
    check(res, { [`${path} -> ${res.status}`]: () => res.status === 200 })
  }
}
