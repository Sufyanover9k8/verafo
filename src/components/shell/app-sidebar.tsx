import { useMemo } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useIsAdmin } from '@/lib/admin'
import { NAV_SECTIONS, SETTINGS_ITEM, type NavItem } from '@/components/layout/nav'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { StoreSwitcher } from './store-switcher'
import { UserMenu } from './user-menu'

function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.end) return pathname === item.to
  // "/orders" must not stay lit on "/orders/new" or "/orders/pending".
  const deeper = NAV_SECTIONS.flatMap((s) => s.items).filter(
    (n) => n.to !== item.to && n.to.startsWith(item.to + '/'),
  )
  if (deeper.some((n) => pathname === n.to || pathname.startsWith(n.to + '/'))) return false
  return pathname === item.to || pathname.startsWith(item.to + '/')
}

const ITEM_CLASS =
  'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-[inset_2px_0_0_var(--sidebar-primary)]'

const GROUP_LABEL_CLASS = 'text-[11px] font-semibold tracking-wider text-sidebar-foreground/50 uppercase'

function NavRow({ item }: { item: NavItem }) {
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActivePath(pathname, item)} tooltip={item.label} className={ITEM_CLASS}>
        <NavLink to={item.to} end={item.end} onClick={() => setOpenMobile(false)}>
          <item.icon />
          <span>{item.label}</span>
        </NavLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

export function AppSidebar() {
  const { admin } = useIsAdmin()
  const sections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.adminOnly || admin),
      })).filter((section) => section.items.length > 0),
    [admin],
  )

  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader className="gap-3 pb-1">
        <NavLink to="/" className="flex h-9 items-center gap-2 px-2 group-data-[collapsible=icon]:px-0">
          <img src="/verafo-logo.png" alt="Verafo" className="size-7 shrink-0 object-contain" />
          <img
            src="/verafo-text-logo.png"
            alt="Verafo"
            className="h-4 object-contain group-data-[collapsible=icon]:hidden"
          />
        </NavLink>
        <StoreSwitcher />
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.label ?? 'main'}>
            {section.label && <SidebarGroupLabel className={GROUP_LABEL_CLASS}>{section.label}</SidebarGroupLabel>}
            <SidebarMenu>
              {section.items.map((item) => (
                <NavRow key={item.to} item={item} />
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
        <SidebarGroup>
          <SidebarGroupLabel className={GROUP_LABEL_CLASS}>Account</SidebarGroupLabel>
          <SidebarMenu>
            <NavRow item={SETTINGS_ITEM} />
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
