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
        className="h-9 w-56 ps-8 font-mono text-[13px]"
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
        <Button variant="ghost" size="icon" className="size-9" aria-label="Change theme">
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
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/70 md:px-6">
      <SidebarTrigger className="-ms-1" />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        {sectionOf?.label && <span className="hidden text-muted-foreground sm:inline">{sectionOf.label}</span>}
        {sectionOf?.label && <span className="hidden text-muted-foreground/50 sm:inline">/</span>}
        <span className="truncate font-medium text-foreground">{current?.label ?? 'Overview'}</span>
      </nav>

      <div className="ms-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={palette.open}
          className="h-9 gap-2 px-3 text-muted-foreground"
          aria-label="Open command palette (Ctrl+K)"
        >
          <Search className="size-4" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="ms-2 hidden rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground md:inline">
            Ctrl K
          </kbd>
        </Button>
        <QuickCheck />
        <span
          className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground xl:inline-flex"
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
