import type { ReactNode } from 'react'
import { normalizePhone } from './format'

export const MENTION_RE = /@([^\s]+)/g
export const STORE_MENTION_RE = /#([^\s]+)/g

export type MentionKind = 'buyer' | 'store'

export interface ActiveMention {
  at: number
  query: string
  kind: MentionKind
}

export function activeMention(text: string, cursor: number): ActiveMention | null {
  const before = text.slice(0, cursor)
  const atBuyer = before.lastIndexOf('@')
  const atStore = before.lastIndexOf('#')
  if (atBuyer === -1 && atStore === -1) return null
  const at = Math.max(atBuyer, atStore)
  const kind: MentionKind = at === atStore ? 'store' : 'buyer'
  const fragment = before.slice(at + 1)
  if (/\s/.test(fragment)) return null
  return { at, query: fragment, kind }
}

export function mentionPhones(text: string): string[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((m) => normalizePhone(m[1])))].filter(
    (p) => p.length >= 6,
  )
}

function renderParts(text: string): (string | { type: 'buyer'; value: string } | { type: 'store'; value: string })[] {
  const parts: (string | { type: 'buyer'; value: string } | { type: 'store'; value: string })[] = []
  let last = 0
  const tokens: { index: number; len: number; type: 'buyer' | 'store'; value: string }[] = []
  for (const m of text.matchAll(MENTION_RE)) {
    tokens.push({ index: m.index ?? 0, len: m[0].length, type: 'buyer', value: normalizePhone(m[1]) })
  }
  for (const m of text.matchAll(STORE_MENTION_RE)) {
    tokens.push({ index: m.index ?? 0, len: m[0].length, type: 'store', value: m[1] })
  }
  tokens.sort((a, b) => a.index - b.index)
  for (const t of tokens) {
    parts.push(text.slice(last, t.index))
    parts.push({ type: t.type, value: t.value })
    last = t.index + t.len
  }
  parts.push(text.slice(last))
  return parts
}

export function renderMentions(text: string): ReactNode[] {
  return renderParts(text).map((p, i) => {
    if (typeof p === 'string') return p
    if (p.type === 'buyer') {
      return (
        <span key={i} className="mention">
          @{p.value}
        </span>
      )
    }
    return (
      <span key={i} className="mention mention-store">
        #{p.value}
      </span>
    )
  })
}