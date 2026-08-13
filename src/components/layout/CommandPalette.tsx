import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../Icon'
import { NAV_SECTIONS, SETTINGS_ITEM } from './nav'
import { supabase } from '../../lib/supabase'
import { useStoreScope, type ActiveStore } from '../../lib/store'
import { normalizePhone } from '../../lib/format'
import { CommandPaletteContext } from './palette'

type PaletteItem =
  | { kind: 'page'; label: string; to: string; icon: string }
  | { kind: 'store'; label: string; store: ActiveStore; icon: string }
  | { kind: 'network'; label: string; icon: string }
  | { kind: 'phone'; label: string; phone: string; icon: string }

const PAGE_ICONS: Record<string, string> = {
  Dashboard: 'stats-chart',
  'New Order': 'add',
  Outcomes: 'clipboard',
  'Buyer Lookup': 'search',
  'Buyer Map': 'layers',
  'Ask Verafo': 'chatbubbles',
  'Bulk Import': 'cloud-upload',
  Settings: 'settings',
}

interface Group {
  label: string
  items: PaletteItem[]
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const value = useMemo(
    () => ({
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
    }),
    [],
  )

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      {isOpen && <Palette onClose={() => setIsOpen(false)} />}
    </CommandPaletteContext.Provider>
  )
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { store, setStore } = useStoreScope()
  const [query, setQuery] = useState('')
  const [stores, setStores] = useState<ActiveStore[]>([])
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)
  const rpcBroken = useRef(false)

  useEffect(() => {
    lastFocused.current = document.activeElement as HTMLElement | null
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return
    let alive = true
    const timer = window.setTimeout(async () => {
      if (!rpcBroken.current) {
        const { data, error } = await client.rpc('search_stores', { p_query: query.trim(), p_limit: 8 })
        if (error) rpcBroken.current = true
        else if (alive) {
          setStores((data ?? []) as ActiveStore[])
          return
        }
      }
      if (alive) {
        const { data: all } = await client.from('stores').select('id, name').order('name')
        if (all) setStores(all as ActiveStore[])
      }
    }, query.trim() ? 150 : 0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    return () => lastFocused.current?.focus?.()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const locationKey = location.pathname + location.search
  const lastKey = useRef(locationKey)
  useEffect(() => {
    if (lastKey.current === locationKey) return
    lastKey.current = locationKey
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey])

  const q = query.trim().toLowerCase()
  const trimmed = query.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  const isPhone = digits.length >= 7 && !q.includes('@')

  const groups: Group[] = (function build() {
    const out: Group[] = []

    const pages: PaletteItem[] = [
      ...NAV_SECTIONS.flatMap((s) => s.items).map((n) => ({
        kind: 'page' as const,
        label: n.label,
        to: n.to,
        icon: PAGE_ICONS[n.label] ?? 'sparkles',
      })),
      { kind: 'page' as const, label: SETTINGS_ITEM.label, to: SETTINGS_ITEM.to, icon: 'settings' },
    ]
    const visiblePages = q
      ? pages.filter((p) => p.kind === 'page' && (p.label.toLowerCase().includes(q) || p.to.split('/').pop()?.startsWith(q)))
      : pages
    if (visiblePages.length) out.push({ label: 'Go to', items: visiblePages })

    if (isPhone) {
      out.unshift({
        label: 'Actions',
        items: [{ kind: 'phone', label: `Search buyer ${trimmed}`, phone: normalizePhone(trimmed), icon: 'search' }],
      })
    }

    const visibleStores = q ? stores.filter((s) => s.name.toLowerCase().includes(q)) : stores
    if (visibleStores.length) {
      out.push({
        label: 'Stores',
        items: visibleStores.map((s) => ({ kind: 'store', label: s.name, store: s, icon: 'storefront' })),
      })
    }

    const qMatchesScope = !q || 'all stores network reset'.includes(q)
    if (store && qMatchesScope) {
      out.push({ label: 'Scope', items: [{ kind: 'network', label: 'All stores — network view', icon: 'business' }] })
    }

    return out
  })()

  const items = groups.flatMap((g) => g.items)
  useEffect(() => {
    setIndex(0)
  }, [q, items.length])

  function run(item: PaletteItem) {
    onClose()
    if (item.kind === 'page') navigate(item.to)
    else if (item.kind === 'store') {
      setStore(item.store)
      navigate(`/stores/${item.store.id}`)
    } else if (item.kind === 'network') {
      setStore(null)
      navigate('/')
    } else if (item.kind === 'phone') {
      navigate(`/lookup?phone=${encodeURIComponent(item.phone)}`)
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setIndex(items.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[Math.min(index, items.length - 1)]
      if (item) run(item)
    }
  }

  let flatIdx = -1

  return createPortal(
    <div
      className="palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input-row">
          <Icon name="search" size={18} className="palette-search-icon" />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Jump to a page, store, or phone number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="searchbox"
            aria-label="Command palette"
            spellCheck={false}
          />
          <kbd className="palette-kbd">ESC</kbd>
        </div>

        <div className="palette-results">
          {items.length === 0 && (
            <div className="palette-empty">
              No matches for “{trimmed}”. Try a page, store, or phone number.
            </div>
          )}

          {groups.map((group) => (
            <div key={group.label}>
              <span className="palette-group-label">{group.label}</span>
              {group.items.map((item) => {
                flatIdx += 1
                const active = flatIdx === index
                return (
                  <button
                    key={`${item.kind}:${item.label}`}
                    className={`palette-item${active ? ' active' : ''}`}
                    onMouseEnter={() => setIndex(flatIdx)}
                    onClick={() => run(item)}
                    type="button"
                  >
                    <Icon name={item.icon} size={16} className="palette-item-icon" />
                    <span className="palette-item-label">{item.label}</span>
                    {item.kind === 'page' && <span className="palette-item-hint">Go</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}