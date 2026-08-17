import type { LucideIcon } from 'lucide-react'
import {
  ClipboardList,
  LayoutDashboard,
  Layers,
  MessageSquare,
  PlusSquare,
  Search,
  Settings,
  Store,
  UploadCloud,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  adminOnly?: boolean
}

export interface NavSection {
  label?: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operate',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/orders/new', label: 'New Order', icon: PlusSquare },
      { to: '/orders/pending', label: 'Outcomes', icon: ClipboardList },
      { to: '/stores', label: 'Stores', icon: Store, adminOnly: true },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { to: '/lookup', label: 'Buyer Lookup', icon: Search },
      { to: '/map', label: 'Buyer Map', icon: Layers },
      { to: '/chat', label: 'Ask Verafo', icon: MessageSquare },
    ],
  },
  {
    label: 'Data',
    items: [{ to: '/import', label: 'Bulk Import', icon: UploadCloud }],
  },
]

export const SETTINGS_ITEM: NavItem = { to: '/settings', label: 'Settings', icon: Settings }
