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