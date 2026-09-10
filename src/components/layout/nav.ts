import type { LucideIcon } from 'lucide-react'
import {
  ClipboardCheck,
  LayoutDashboard,
  MapPinned,
  MessageSquare,
  Package,
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

/**
 * IA modelled on GoKwik's COD/RTO console, branded for Verafo:
 *   Operate  — the day-to-day: overview, the order book, logging + resolving
 *   Analyse  — buyer intelligence, RTO geography, the AI analyst
 *   Data     — bringing history in
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operate',
    items: [
      { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/orders', label: 'Orders', icon: Package },
      { to: '/orders/new', label: 'New Order', icon: PlusSquare },
      { to: '/orders/pending', label: 'Outcomes', icon: ClipboardCheck },
      { to: '/stores', label: 'Stores', icon: Store, adminOnly: true },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { to: '/lookup', label: 'Buyers', icon: Search },
      { to: '/map', label: 'RTO Insights', icon: MapPinned },
      { to: '/chat', label: 'Ask Verafo', icon: MessageSquare },
    ],
  },
  {
    label: 'Data',
    items: [{ to: '/import', label: 'Import', icon: UploadCloud }],
  },
]

export const SETTINGS_ITEM: NavItem = { to: '/settings', label: 'Settings', icon: Settings }
