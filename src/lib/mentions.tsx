import type { ReactNode } from 'react'
import { normalizePhone } from './format'

export const MENTION_RE = /@([^\s]+)/g

export function activeMention(text: string, cursor: number): { at: number; query: string } | null {
  const before = text.slice(0, cursor)
  const at = before.lastIndexOf('@')
  if (at === -1) return null
  const fragment = before.slice(at + 1)
  if (/\s/.test(fragment)) return null
  return { at, query: fragment }
}

export function mentionPhones(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((m) => normalizePhone(m[1])))].filter(
    (p) => p.length >= 6,
  )
}

export function renderMentions(text: string): ReactNode[] {
  const parts: (string | { phone: string })[] = []
  let last = 0
  for (const m of text.matchAll(MENTION_RE)) {
    if (m.index !== undefined) {
      parts.push(text.slice(last, m.index))
      parts.push({ phone: normalizePhone(m[1]) })
      last = m.index + m[0].length
    }
  }
  parts.push(text.slice(last))
  return parts.map((p, i) =>
    typeof p === 'string' ? p : (
      <span key={i} className="mention">
        @{p.phone}
      </span>
    ),
  )
}
