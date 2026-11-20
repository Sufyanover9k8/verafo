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
import { CallCredits } from './call-credits'
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
  'rounded-xl data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:font-semibold'

const GROUP_LABEL_CLASS =
  'text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45'

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
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="gap-3 pb-1">
        <NavLink to="/dashboard" className="flex h-11 items-center gap-2 px-2 group-data-[collapsible=icon]:px-0">
          {/* Both logos ship as fixed-colour art and the rail is always dark,
              so both are inverted to white regardless of theme. */}
          <img
            src="/verafo-logo.png"
            alt="Verafo"
            className="size-7 shrink-0 object-contain brightness-0 invert"
          />
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
        <CallCredits />
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
