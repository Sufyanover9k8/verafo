import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Building2,
  CornerDownLeft,
  Search,
  Settings,
  Sparkles,
  Store as StoreIcon,
  type LucideIcon,
} from 'lucide-react'
import { NAV_SECTIONS, SETTINGS_ITEM } from './nav'
import { useIsAdmin } from '../../lib/admin'
import { supabase } from '../../lib/supabase'
import { useStoreScope, type ActiveStore } from '../../lib/store'
import { normalizePhone } from '../../lib/format'
import { cn } from '../../lib/utils'
import { CommandPaletteContext } from './palette'

type PaletteItem =
  | { kind: 'page'; label: string; to: string; icon: LucideIcon }
  | { kind: 'store'; label: string; store: ActiveStore; icon: LucideIcon }
  | { kind: 'network'; label: string; icon: LucideIcon }
  | { kind: 'phone'; label: string; phone: string; icon: LucideIcon }

/** Icons for the rows the palette adds itself. Pages carry their own from nav.ts. */
const SETTINGS_ICON: LucideIcon = Settings

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
  // Same gate the sidebar uses, so a row hidden from the sidebar is not
  // offered here instead — and typing "new order" as a merchant finds nothing.
  const { admin } = useIsAdmin()
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
  }, [locationKey, onClose])

  const q = query.trim().toLowerCase()
  const trimmed = query.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  const isPhone = digits.length >= 7 && !q.includes('@')

  const groups: Group[] = (function build() {
    const out: Group[] = []

    const pages: PaletteItem[] = [
      ...NAV_SECTIONS.flatMap((s) => s.items)
        .filter((n) => !n.adminOnly || admin)
        .map((n) => ({
          kind: 'page' as const,
          label: n.label,
          to: n.to,
          icon: n.icon,
        })),
      {
        kind: 'page' as const,
        label: SETTINGS_ITEM.label,
        to: SETTINGS_ITEM.to,
        icon: SETTINGS_ICON,
      },
    ]
    const visiblePages = q
      ? pages.filter(
          (p) =>
            p.kind === 'page' &&
            (p.label.toLowerCase().includes(q) || p.to.split('/').pop()?.startsWith(q)),
        )
      : pages
    if (visiblePages.length) out.push({ label: 'Go to', items: visiblePages })

    if (isPhone) {
      out.unshift({
        label: 'Actions',
        items: [
          { kind: 'phone', label: `Search buyer ${trimmed}`, phone: normalizePhone(trimmed), icon: Search },
        ],
      })
    }

    const visibleStores = q ? stores.filter((s) => s.name.toLowerCase().includes(q)) : stores
    if (visibleStores.length) {
      out.push({
        label: 'Stores',
        items: visibleStores.map((s) => ({ kind: 'store' as const, label: s.name, store: s, icon: StoreIcon })),
      })
    }

    const qMatchesScope = !q || 'all stores network reset'.includes(q)
    if (store && qMatchesScope) {
      out.push({ label: 'Scope', items: [{ kind: 'network', label: 'All stores — network view', icon: Building2 }] })
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-[16px] border border-border bg-popover shadow-3"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            className="h-12 min-w-0 flex-1 border-0 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Jump to a page, store, or phone number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="searchbox"
            aria-label="Command palette"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="Results">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-[13.5px] text-muted-foreground">
              No matches for “{trimmed}”. Try a page, store, or phone number.
            </p>
          )}

          {groups.map((group) => (
            <div key={group.label}>
              <span className="block px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {group.label}
              </span>
              {group.items.map((item) => {
                flatIdx += 1
                const active = flatIdx === index
                const ItemIcon = item.icon
                return (
                  <button
                    key={`${item.kind}:${item.label}`}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-start text-[14px]',
                      active ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted/60',
                    )}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setIndex(flatIdx)}
                    onClick={() => run(item)}
                    type="button"
                  >
                    <ItemIcon
                      className={cn('size-4 shrink-0', active ? 'text-primary-text' : 'text-muted-foreground')}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.kind === 'page' && (
                      <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground">
                        Go <CornerDownLeft className="size-3" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
          <Sparkles className="size-3.5 text-primary-text" aria-hidden="true" />
          <span>↑ ↓ to move · Enter to open · Esc to close</span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
