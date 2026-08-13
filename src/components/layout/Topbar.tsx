import { Link, useLocation } from 'react-router-dom'
import { Menu, Moon, Search, Sun } from 'lucide-react'
import { isConfigured } from '../../lib/supabase'
import { useTheme } from '../../lib/theme'
import { useCommandPalette } from './palette'
import { StoreSwitcher } from './StoreSwitcher'
import { NAV_SECTIONS, SETTINGS_ITEM } from './nav'

interface TopbarProps {
  onMenu: () => void
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
          <strong>{current?.label ?? 'Dashboard'}</strong>
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
        <Link className="btn btn-secondary btn-sm hide-mobile" to="/lookup">
          <Search size={14} /> Look up a buyer
        </Link>
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
