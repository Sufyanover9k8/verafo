const PALETTE: { from: string; to: string; text: string }[] = [
  { from: '#5EEAD4', to: '#0D9488', text: '#042F2E' },
  { from: '#A78BFA', to: '#7C3AED', text: '#2E1065' },
  { from: '#F9A8D4', to: '#DB2777', text: '#500724' },
  { from: '#FCD34D', to: '#D97706', text: '#451A03' },
  { from: '#6EE7B7', to: '#059669', text: '#022C22' },
  { from: '#93C5FD', to: '#2563EB', text: '#172554' },
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

export function Avatar({ name, phone, size = 34, className }: AvatarProps) {
  const key = `${name ?? ''}|${phone ?? ''}`
  const { from, to, text } = PALETTE[hash(key) % PALETTE.length]
  const label = name?.trim() ? initials(name) : (phone?.replace(/\D/g, '').slice(-2) || '?')
  return (
    <span
      className={`avatar${className ? ` ${className}` : ''}`}
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        color: text,
        fontSize: Math.round(size * 0.36),
      }}
      aria-hidden="true"
    >
      {label}
    </span>
  )
}