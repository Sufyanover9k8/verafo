import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Source-level guards for the Verafo AI Edge Function.
 *
 * WHY THIS FILE EXISTS
 * The Edge Function runs on the service-role key, which bypasses RLS, so its
 * isolation from other merchants depends entirely on code. It cannot be
 * imported here: it pulls its dependencies from JSR and calls `Deno.serve` at
 * module scope. These tests therefore assert INVARIANTS OVER ITS SOURCE TEXT,
 * which is what actually causes the cross-merchant regressions this file
 * guards against. A behavioural test of the deployed function still has to run
 * against Supabase.
 *
 * Each test below names the real production incident it prevents from
 * returning.
 */

const EDGE_SOURCE = readFileSync(
  resolve(__dirname, '../../../supabase/functions/verafo-ai/index.ts'),
  'utf8',
)

describe('PRIVACY: the edge function cannot read another merchant\'s orders', () => {
  it('never degrades the store filter to an empty string', () => {
    // REGRESSION: storeIdFilter() used to `return ""` for a caller with no
    // owned stores. The empty string removed the filter entirely, so the
    // "no stores" case silently read EVERY merchant's orders.
    const fn = EDGE_SOURCE.slice(
      EDGE_SOURCE.indexOf('function storeIdFilter'),
      EDGE_SOURCE.indexOf('function storeIdFilter') + 600,
    )
    expect(fn).not.toBe('')
    expect(fn).toContain('NO_STORE_SENTINEL')
    expect(fn).not.toMatch(/length === 0\)\s*return ""/)
  })

  it('keeps the fail-closed backstop on every raw private-table read', () => {
    expect(EDGE_SOURCE).toContain('const PRIVATE_TABLES = new Set(["orders"])')
    expect(EDGE_SOURCE).toContain('refusing an unscoped')
  })

  it('filters every direct orders read by store_id', () => {
    // Any `from("orders")` read that is not store-scoped would leak. Walking
    // the source rather than trusting a single call site is the point.
    const reads = EDGE_SOURCE.split('.from("orders")').slice(1)
    expect(reads.length).toBeGreaterThan(0)
    for (const tail of reads) {
      const window = tail.slice(0, 400)
      const scoped =
        window.includes('store_id') || window.includes('storeIdFilter')
      expect(scoped, `unscoped orders read:\n${window.slice(0, 160)}`).toBe(true)
    }
  })

  it('scopes the buyer lookups that used to read the whole table', () => {
    const fetchStats = EDGE_SOURCE.slice(
      EDGE_SOURCE.indexOf('async function fetchStats'),
      EDGE_SOURCE.indexOf('async function fetchStats') + 1200,
    )
    expect(fetchStats).toContain('storeIds')
    expect(fetchStats).toContain('.in("store_id", storeIds)')

    const featureVector = EDGE_SOURCE.slice(
      EDGE_SOURCE.indexOf('async function buildFeatureVector'),
      EDGE_SOURCE.indexOf('async function buildFeatureVector') + 1200,
    )
    expect(featureVector).toContain('.in("store_id", storeIds)')
    // The vector columns are large and pointless to ship to the browser; the
    // builder must never select them.
    expect(featureVector).not.toContain('select("*")')
  })
})

describe('PRIVACY: buyer search is not an enumeration endpoint', () => {
  it('refuses partial-phone searches', () => {
    // REGRESSION: the tool ran `phone ilike '%<digits>%'` against the whole
    // `buyers` table. Because phone is the primary key, a merchant could walk
    // prefixes and harvest every buyer's number network-wide.
    const fn = EDGE_SOURCE.slice(
      EDGE_SOURCE.indexOf('async function toolSearchBuyers'),
      EDGE_SOURCE.indexOf('async function toolSearchBuyers') + 3000,
    )
    expect(fn).not.toContain('ilike')
    expect(fn).toContain('FULL_PHONE_DIGITS')
    expect(fn).toContain('enumerate')
  })

  it('never passes an empty candidate list to a phone filter', () => {
    // An empty `in (...)` list matches every row, so the short-input case must
    // bail out before the query is built.
    const fn = EDGE_SOURCE.slice(
      EDGE_SOURCE.indexOf('function phoneLookupCandidates'),
      EDGE_SOURCE.indexOf('function phoneLookupCandidates') + 700,
    )
    expect(fn).toContain('if (digits.length < FULL_PHONE_DIGITS) return []')
  })

  it('masks buyer identities in the ranking path', () => {
    expect(EDGE_SOURCE).toContain('verafo_buyer_ranking')
    expect(EDGE_SOURCE).toContain('buyer_label')
  })
})

describe('HYGIENE: the edge function stays typed and encoding-safe', () => {
  // The mojibake detector below contains those characters ON PURPOSE, so it is
  // built from escapes. Writing them literally gets this file flagged by its
  // own repo-wide encoding scan.
  const MOJIBAKE = new RegExp(
    [
      '\u00c3', // A-tilde
      '\u00c2', // A-circumflex
      '\u00e2\u20ac', // a-circumflex + euro
      '\u00c5', // A-ring
      '\u00c6', // AE
      '\u0192', // f-hook
      '\uFFFD', // replacement character
    ].join('|'),
  )

  it('detects the corruption it is guarding against', () => {
    // Guards the guard: if MOJIBAKE were built wrongly the test below would
    // pass vacuously and stop protecting anything.
    expect(MOJIBAKE.test('\u00c3\u00a2\u20ac\u201d')).toBe(true)
    expect(MOJIBAKE.test('\u00c2\u00b7')).toBe(true)
    expect(MOJIBAKE.test('plus 92 300 1234567')).toBe(false)
  })

  it('contains no broad `as any` cast', () => {
    expect(EDGE_SOURCE).not.toMatch(/\bas any\b/)
  })

  it('contains no mojibake', () => {
    // PowerShell's Set-Content writes ANSI and has twice corrupted this file.
    expect(MOJIBAKE.test(EDGE_SOURCE)).toBe(false)
  })

  it('keeps the masked buyer label intact', () => {
    // The runtime literal is four middle dots; mojibake once destroyed it.
    expect(EDGE_SOURCE).toContain('"\u00b7\u00b7\u00b7\u00b7"')
  })
})
