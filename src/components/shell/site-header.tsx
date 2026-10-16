import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Monitor, Moon, Search, Sun } from 'lucide-react'
import { isConfigured } from '@/lib/supabase'
import { normalizePhone } from '@/lib/format'
import { useTheme, type Theme } from '@/lib/theme'
import { useCommandPalette } from '@/components/layout/palette'
import { NAV_SECTIONS, SETTINGS_ITEM } from '@/components/layout/nav'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'

/** Type a phone number, press Enter, get the verdict. Always one keystroke away. */
function QuickCheck() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    const p = normalizePhone(value)
    if (p.length < 6) return
    navigate(`/lookup?phone=${encodeURIComponent(p)}`)
    setValue('')
  }

  return (
    <form onSubmit={submit} role="search" className="relative hidden lg:block">
      <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="tel"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Check a buyer by phone"
        aria-label="Check a buyer by phone number"
        className="h-9 w-56 border-topbar-border bg-transparent ps-8 font-mono text-[13px] text-topbar-foreground placeholder:text-topbar-muted focus-visible:border-topbar-foreground focus-visible:outline-none focus-visible:ring-0 dark:bg-transparent"
      />
    </form>
  )
}

function ThemeMenu() {
  const { theme, resolved, setTheme } = useTheme()
  const Icon = resolved === 'dark' ? Moon : Sun
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="topbar-control size-11 rounded-full text-topbar-foreground hover:text-topbar-foreground focus-visible:ring-topbar-foreground/50 md:size-9"
          aria-label="Change theme"
        >
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4" /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4" /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4" /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SiteHeader() {
  const { pathname } = useLocation()
  const palette = useCommandPalette()

  const sectionOf = NAV_SECTIONS.find((s) => s.items.some((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to))))
  const all = NAV_SECTIONS.flatMap((s) => s.items).concat(SETTINGS_ITEM)
  // Longest matching path wins so "/orders/new" reads "New Order", not "Orders".
  const current = all
    .filter((n) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + '/')))
    .sort((a, b) => b.to.length - a.to.length)[0]

  return (
    /* The top bar is the Verafo teal, the same surface as the sidebar, so the
       two read as one frame around the white content area. It is opaque on
       purpose: a translucent teal would let the page scroll through it and
       drain the brand colour, and the near-white type needs the full-strength
       fill to hold its contrast. */
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 bg-topbar px-3 text-topbar-foreground md:px-6">
      <SidebarTrigger className="topbar-control -ms-1 size-11 text-topbar-foreground hover:text-topbar-foreground focus-visible:ring-topbar-foreground/50 md:size-8" />
      <Separator orientation="vertical" className="mx-1 hidden h-5 bg-topbar-border sm:block" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        {sectionOf?.label && <span className="hidden text-topbar-muted sm:inline">{sectionOf.label}</span>}
        {sectionOf?.label && <span className="hidden text-topbar-muted/70 sm:inline">/</span>}
        <span className="truncate font-medium text-topbar-foreground">{current?.label ?? 'Dashboard'}</span>      </nav>

      <div className="ms-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={palette.open}
          className="topbar-control h-11 gap-2 border-topbar-border bg-transparent px-3 text-topbar-foreground hover:text-topbar-foreground focus-visible:ring-topbar-foreground/50 dark:bg-transparent dark:hover:bg-transparent max-sm:w-11 max-sm:justify-center max-sm:px-0 md:h-9"
          aria-label="Open command palette (Ctrl+K)"
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ms-2 hidden rounded border border-topbar-border bg-topbar-chip px-1.5 font-mono text-[10px] font-medium text-topbar-foreground md:inline">
            Ctrl K
          </kbd>
        </Button>
        <QuickCheck />
        <span
          className="hidden items-center gap-1.5 rounded-full border border-topbar-border bg-topbar-chip px-2.5 py-1 text-xs font-medium text-topbar-foreground xl:inline-flex"
          title={isConfigured ? 'Connected to Verafo' : 'Supabase is not configured'}
        >
          <span className={`size-1.5 rounded-full ${isConfigured ? 'bg-success' : 'bg-warning'}`} />
          {isConfigured ? 'Live' : 'Setup needed'}
        </span>
        <ThemeMenu />
      </div>
    </header>
  )
}
