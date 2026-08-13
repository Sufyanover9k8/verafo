import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen, ShieldCheck } from 'lucide-react'
import { NAV_SECTIONS, SETTINGS_ITEM } from './nav'

interface SidebarProps {
  collapsed: boolean
  mobileOpen: boolean
  onToggle: () => void
  onNavigate: () => void
}

export function Sidebar({ collapsed, mobileOpen, onToggle, onNavigate }: SidebarProps) {
  return (
    <>
      {mobileOpen && <div className="sidebar-backdrop" onClick={onNavigate} aria-hidden="true" />}
      <aside className="sidebar" aria-label="Main navigation">
        <div className="sidebar-head">
          <span className="sidebar-brand-mark">
            <ShieldCheck size={18} strokeWidth={2} />
          </span>
          <span className="sidebar-brand-name">Verafo</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label ?? 'main'}>
              {section.label && <span className="sidebar-section-label">{section.label}</span>}
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
                  onClick={onNavigate}
                  title={item.label}
                >
                  <item.icon className="sidebar-item-icon" size={18} strokeWidth={1.75} />
                  <span className="sidebar-item-label">{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}

          <span className="sidebar-section-label">Account</span>
          <NavLink
            to={SETTINGS_ITEM.to}
            className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
            onClick={onNavigate}
            title={SETTINGS_ITEM.label}
          >
            <SETTINGS_ITEM.icon className="sidebar-item-icon" size={18} strokeWidth={1.75} />
            <span className="sidebar-item-label">{SETTINGS_ITEM.label}</span>
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <button className="sidebar-toggle" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.75} /> : <PanelLeftClose size={18} strokeWidth={1.75} />}
            <span className="sidebar-toggle-label">Collapse</span>
          </button>
        </div>
      </aside>
    </>
  )
}
