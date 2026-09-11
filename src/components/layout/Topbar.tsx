import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Menu, Moon, Search, Sun } from 'lucide-react'
import { isConfigured } from '../../lib/supabase'
import { normalizePhone } from '../../lib/format'
import { useTheme } from '../../lib/theme'
import { useCommandPalette } from './palette'
import { StoreSwitcher } from './StoreSwitcher'
import { NAV_SECTIONS, SETTINGS_ITEM } from './nav'

interface TopbarProps {
  onMenu: () => void
}

/** Always-available quick check — type a number, hit enter, get the verdict. */
function QuickCheck() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const p = normalizePhone(value)
    if (p.length < 6) return
    navigate(`/lookup?phone=${encodeURIComponent(p)}`)
    setValue('')
  }

  return (
    <form className="quick-check hide-mobile" onSubmit={submit} role="search">
      <Search size={14} className="quick-check-icon" aria-hidden="true" />
      <input
        type="tel"
        className="mono quick-check-input"
        placeholder="Check a buyer…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Check a buyer by phone number"
      />
    </form>
  )
}

export function Topbar({ onMenu }: TopbarProps) {
  const { theme, resolved, setTheme } = useTheme()
  const location = useLocation()
  const palette = useCommandPalette()

  const all = NAV_SECTIONS.flatMap((s) => s.items).concat(SETTINGS_ITEM)
  const current = all.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))

  const toggleTheme = () => {
    const next = theme === 'system' ? (resolved === 'dark' ? 'light' : 'dark') : theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="menu-btn" onClick={onMenu} aria-label="Toggle navigation">
          <Menu size={20} />
        </button>
        <span className="topbar-context">
          <strong>{current?.label ?? 'Overview'}</strong>
          <span className="hide-mobile"> · COD risk intelligence</span>
        </span>
      </div>

      <div className="topbar-right">
        <button className="palette-trigger" onClick={palette.open} aria-label="Open command palette (Ctrl+K)">
          <Search size={15} />
          <span className="hide-mobile">Search…</span>
          <kbd className="hide-mobile">Ctrl K</kbd>
        </button>
        <StoreSwitcher />
        <QuickCheck />
        <span className={`conn-pill${isConfigured ? '' : ' warn'}`}>
          <span className="conn-dot" />
          {isConfigured ? 'live' : 'setup needed'}
        </span>
        <button className="topbar-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  )
}
