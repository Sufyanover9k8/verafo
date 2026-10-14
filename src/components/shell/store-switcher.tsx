import { useNavigate } from 'react-router-dom'
import { Building2, Check, ChevronsUpDown, Globe } from 'lucide-react'
import { isConfigured } from '@/lib/supabase'
import { useStoreScope } from '@/lib/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'

/**
 * Store scoping control, shown in the sidebar header.
 *   Admin               - "All stores (network)" plus any single store.
 *   Merchant, >1 store  - switch between their own stores (no network option).
 *   Merchant, <=1 store - a plain label (nothing to switch).
 */
export function StoreSwitcher() {
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const { role, stores, store, setStore } = useStoreScope()
  const isAdmin = role === 'admin'

  if (!isConfigured) return null

  const label = store?.name ?? (isAdmin ? 'All stores' : 'Your store')
  const sub = store ? 'Store' : isAdmin ? 'Network view' : ''
  const canSwitch = isAdmin || stores.length > 1
  const Icon = store ? Building2 : Globe

  const body = (
    <>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
        <Icon className="size-4" />
      </div>
      <div className="grid flex-1 text-start text-sm leading-tight">
        <span className="truncate font-medium">{label}</span>
        {sub && <span className="truncate text-xs text-sidebar-foreground/60">{sub}</span>}
      </div>
      {canSwitch && <ChevronsUpDown className="ms-auto size-4 text-sidebar-foreground/60" />}
    </>
  )

  if (!canSwitch) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent">
            {body}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              {body}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-64 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">Scope Verafo to</DropdownMenuLabel>
            {isAdmin && (
              <DropdownMenuItem className="gap-2" onClick={() => setStore(null)}>
                <Globe className="size-4" />
                All stores (network)
                {!store && <Check className="ms-auto size-4" />}
              </DropdownMenuItem>
            )}
            {isAdmin && stores.length > 0 && <DropdownMenuSeparator />}
            {stores.map((s) => (
              <DropdownMenuItem
                key={s.id}
                className="gap-2"
                onClick={() => {
                  setStore({ id: s.id, name: s.name })
                  if (isAdmin) navigate(`/stores/${s.id}`)
                }}
              >
                <Building2 className="size-4" />
                <span className="truncate">{s.name}</span>
                {store?.id === s.id && <Check className="ms-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
