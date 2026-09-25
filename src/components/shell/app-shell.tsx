import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
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
 * The signed-in frame: navy sidebar, sticky top bar, content area.
 * Pages render as children. The `main` / `chat-main` classes are the legacy
 * content-padding rules that not-yet-ported pages still rely on.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
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
        <SidebarInset className="min-w-0 bg-background">
          <SiteHeader />
          <main className={`main${pathname === '/chat' ? ' chat-main' : ''}`}>{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </LayoutTickContext.Provider>
  )
}
