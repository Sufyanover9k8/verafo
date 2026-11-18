/* format.ts — owns all number/phone/date formatting. */

export function currency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `PKR ${Math.round(Number(n)).toLocaleString('en-PK')}`
}

export function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `PKR ${new Intl.NumberFormat('en-PK').format(Number(n))}`
}

export function phone(p: string | null | undefined): string {
  if (!p) return '—'
  let digits = p.replace(/[^\d+]/g, '')
  const hasPlus = digits.startsWith('+')
  if (hasPlus) digits = digits.slice(1)
  if (digits.startsWith('92') && digits.length >= 11) digits = '0' + digits.slice(2)
  const groups = [4, 3, 4]
  let out = ''
  let i = 0
  for (const g of groups) {
    if (i >= digits.length) break
    out += (out ? ' ' : '') + digits.slice(i, i + g)
    i += g
  }
  if (i < digits.length) out += ' ' + digits.slice(i)
  return out
}

/**
 * One canonical form per human, used as the buyer key everywhere.
 *
 * Pakistani numbers collapse to +92XXXXXXXXXX (0300…, 92…, 0092…, bare
 * 3001234567 and +92 300… all become the same string), so the same person is
 * never split across two buyer rows. International numbers keep their + prefix.
 * The Postgres `canonical_phone()` function implements exactly this rule and
 * runs as a trigger, so the client and the database always agree.
 */
export function canonicalPhone(p: string | null | undefined): string {
  if (!p) return ''
  let d = String(p).replace(/[^\d+]/g, '')
  if (!d) return ''
  const hadPlus = d.startsWith('+')
  d = d.replace(/\+/g, '')

  if (d.startsWith('0092')) d = d.slice(2)
  if (d.startsWith('92') && d.length >= 11) d = '0' + d.slice(2)
  else if (!hadPlus && d.length === 10 && d.startsWith('3')) d = '0' + d

  if (d.length === 11 && /^03\d{9}$/.test(d)) return '+92' + d.slice(1)
  if (hadPlus && d.length >= 8) return '+' + d
  return d
}

/** Kept for existing callers: normalising now means canonicalising. */
export const normalizePhone = (p: string): string => canonicalPhone(p)

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function monthKey(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

export function dayKey(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { weekday: 'short' })
}