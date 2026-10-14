import { cn } from '@/lib/utils'

// Avatar colours are the brand's accent family, used as a per-buyer identity
// colour rather than a risk signal. They are written as tokens so they follow
// light/dark mode, and each stop is dark enough for white initials.
const PALETTE: { from: string; to: string; text: string }[] = [
  { from: 'var(--teal-bright)', to: 'var(--teal-deep)', text: '#FFFFFF' }, // teal
  { from: 'var(--purple)', to: 'var(--v-unknown-strong)', text: '#FFFFFF' }, // purple
  { from: 'var(--amber)', to: 'var(--v-watch-strong)', text: '#FFFFFF' }, // amber
  { from: 'var(--coral)', to: 'var(--v-risk-strong)', text: '#FFFFFF' }, // rose
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

function initials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  if (parts.length === 0) return '?'
  return parts.map((p) => p.charAt(0).toUpperCase()).join('')
}

interface AvatarProps {
  name?: string | null
  phone?: string | null
  size?: number
  className?: string
}

/**
 * A buyer or store identity chip: initials (for a named store) or the last two
 * digits of a phone number. Purely decorative — the label beside it always
 * carries the real text, so it stays out of the accessibility tree.
 */
export function Avatar({ name, phone, size = 34, className }: AvatarProps) {
  const key = `${name ?? ''}|${phone ?? ''}`
  const { from, to, text } = PALETTE[hash(key) % PALETTE.length]
  const label = name?.trim() ? initials(name) : (phone?.replace(/\D/g, '').slice(-2) || '?')
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold select-none', className)}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        color: text,
        fontSize: Math.round(size * 0.36),
        lineHeight: 1,
      }}
      aria-hidden="true"
    >
      {label}
    </span>
  )
}
