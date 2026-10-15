import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LayoutTickContext } from '@/lib/motion'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from './app-sidebar'
import { SiteHeader } from './site-header'

const SIDEBAR_KEY = 'verafo.sidebarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The signed-in frame: sidebar, sticky top bar, content area.
 *
 * The content padding lives here as utilities rather than on a `.main` class.
 * That class outlived its stylesheet: once the legacy CSS was retired it
 * matched no rule at all, which left the page heading flush against the sidebar
 * with nothing between them. `px` matches the header's `md:px-6` so the two
 * left edges line up, and the scale tightens on small screens.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => !readCollapsed())
  // Charts re-measure themselves when this changes (the content width moves).
  const [layoutTick, setLayoutTick] = useState(0)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const id = setTimeout(() => setLayoutTick((t) => t + 1), 220)
    return () => clearTimeout(id)
  }, [open])

  function onOpenChange(next: boolean) {
    setOpen(next)
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? '0' : '1')
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <LayoutTickContext.Provider value={layoutTick}>
      <SidebarProvider open={open} onOpenChange={onOpenChange}>
        <AppSidebar />
        <SidebarInset className="min-w-0 overflow-x-hidden bg-background">
          <SiteHeader />
          <main className="min-w-0 px-4 pt-5 pb-16 sm:px-6 sm:pt-6 lg:px-8">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </LayoutTickContext.Provider>
  )
}
