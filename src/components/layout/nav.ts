import type { LucideIcon } from 'lucide-react'
import {
  ClipboardCheck,
  History,
  SlidersHorizontal,
  LayoutDashboard,
  MapPinned,
  MessageSquare,
  Package,
  PlusSquare,
  Search,
  Settings,
  ShieldCheck,
  Store,
  UploadCloud,
} from 'lucide-react'
import { FEATURES } from '@/lib/features'

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
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/orders', label: 'Orders', icon: Package },
      // Logging an order by hand is a Verafo-team tool. Merchants' orders
      // arrive through Bulk Import or the Shopify app, so this row is not
      // theirs to see.
      { to: '/orders/new', label: 'New Order', icon: PlusSquare, adminOnly: true },
      // Unreleased pages. Their switches live in src/lib/features.ts; flipping
      // one on brings the sidebar row, the command-palette entry and the route
      // back together, because all three read that single constant.
      ...(FEATURES.decide
        ? [{ to: '/orders/decide', label: 'Decide', icon: ClipboardCheck }]
        : []),
      ...(FEATURES.scan
        ? [{ to: '/orders/scan', label: 'Historical scan', icon: History }]
        : []),
      ...(FEATURES.simulate
        ? [{ to: '/simulate', label: 'What-if simulator', icon: SlidersHorizontal }]
        : []),
      { to: '/orders/pending', label: 'Outcomes', icon: ClipboardCheck },
      { to: '/stores', label: 'Stores', icon: Store, adminOnly: true },
      // Broadcast messages to the merchants. Verafo-team only.
      { to: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
    ],
  },
  {
    label: 'Analyse',
    items: [
      { to: '/lookup', label: 'Buyer Lookup', icon: Search },
      // The page is the RTO/refusal view: where refusals come from, plotted on
      // the buyer map. The route stays /map so existing links keep working.
      { to: '/map', label: 'RTO Insights', icon: MapPinned },
      { to: '/chat', label: 'Ask Verafo', icon: MessageSquare },
    ],
  },
  {
    label: 'Data',
    items: [{ to: '/import', label: 'Bulk Import', icon: UploadCloud }],
  },
]

export const SETTINGS_ITEM: NavItem = { to: '/settings', label: 'Settings', icon: Settings }
