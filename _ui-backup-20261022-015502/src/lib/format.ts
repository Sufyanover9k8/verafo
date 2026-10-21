/* format.ts — owns all number/phone/date formatting. */

import { formatPhonePK } from './ui/phone'

export function currency(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `PKR ${Math.round(Number(n)).toLocaleString('en-PK')}`
}

export function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `PKR ${new Intl.NumberFormat('en-PK').format(Number(n))}`
}

/**
 * How every phone number in the app is written: `+92 301 2345678`.
 *
 * One format, one place. The number is normalised to its Pakistani national
 * form first, so `03012345678`, `+923012345678`, `0092 301 234 5678` and
 * `923012345678` all print identically — a merchant reading two screens can
 * tell they are looking at the same buyer.
 *
 * A number that cannot be resolved to a Pakistani one is NOT dressed up as
 * `+92 …`, which would assert a country we cannot vouch for. It falls back to
 * the raw value so the merchant still sees whatever the record holds.
 */
export function phone(p: string | null | undefined): string {
  if (!p) return '—'
  const pk = formatPhonePK(p)
  if (pk) return pk.display
  const shown = p.trim()
  return shown || '—'
}

export const normalizePhone = (p: string): string => p.replace(/[^\d+]/g, '')

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