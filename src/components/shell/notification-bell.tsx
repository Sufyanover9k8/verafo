import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Megaphone, PackageCheck, Sparkles } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import {
  ensureDailyDigest,
  loadNotifications,
  markAllRead,
  NOTIFICATIONS_CHANGED,
  type AppNotification,
  type NotificationKind,
} from '@/lib/notifications'

const ICON: Record<NotificationKind, typeof Bell> = {
  outcome: PackageCheck,
  daily: Sparkles,
  admin: Megaphone,
}

/* The tile behind each row's icon. Admin announcements borrow the watch colour
   so an actual message from Verafo never looks like routine order activity. */
const TILE: Record<NotificationKind, string> = {
  outcome: 'bg-risk-safe-soft text-risk-safe-strong',
  daily: 'bg-risk-unknown-soft text-risk-unknown-strong',
  admin: 'bg-risk-watch-soft text-risk-watch-strong',
}

/**
 * The bell in the top bar.
 *
 * Reads on mount, on window focus and once a minute — cheap, and enough for
 * "an outcome was just recorded" to feel immediate without a websocket. Opening
 * the panel marks everything read, which is the behaviour a badge implies.
 */
export function NotificationBell() {
  const navigate = useNavigate()
  const [items, setItems] = useState<AppNotification[]>([])
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    const { rows, failed: bad } = await loadNotifications()
    setItems(rows)
    setFailed(bad)
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      // The digest is written server-side at most once per day, so this is safe
      // on every mount.
      await ensureDailyDigest()
      if (alive) await refresh()
    })()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    // Written by the pages that change an outcome, so the bell is already right
    // when the pointer reaches it — a 60-second poll would leave the merchant
    // staring at a badge that has not caught up with what they just did.
    const onPing = () => void refresh()
    window.addEventListener(NOTIFICATIONS_CHANGED, onPing)
    const timer = window.setInterval(() => void refresh(), 60_000)
    return () => {
      alive = false
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(NOTIFICATIONS_CHANGED, onPing)
      window.clearInterval(timer)
    }
  }, [refresh])

  const unread = items.filter((n) => !n.read_at).length

  async function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) return
    // Read fresh on open: the list is worth more accurate than the poll.
    const { rows, failed: bad } = await loadNotifications()
    setItems(rows)
    setFailed(bad)
    if (rows.every((n) => n.read_at)) return
    await markAllRead()
    const now = new Date().toISOString()
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="topbar-control relative grid size-11 place-items-center rounded-full text-topbar-foreground hover:text-topbar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-topbar-foreground/50 md:size-9"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute end-1 top-1 grid min-w-4 place-items-center rounded-full bg-topbar-foreground px-1 text-[10px] font-bold leading-4 text-topbar">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <DropdownMenuLabel className="flex items-center justify-between px-3 py-2.5 text-[13px]">
          Notifications
          {unread > 0 && (
            <span className="text-[11.5px] font-normal text-muted-foreground">{unread} new</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-80 overflow-y-auto p-1">
          {items.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] leading-relaxed text-muted-foreground">
              {failed
                ? 'Notifications are not switched on yet. Your daily report and messages from Verafo will appear here once they are.'
                : 'Nothing yet. Order outcomes, your daily report and messages from Verafo appear here.'}
            </p>
          ) : (
            items.map((n) => {
              const Icon = ICON[n.kind] ?? Bell
              return (
                <DropdownMenuItem
                  key={n.id}
                  className="items-start gap-2.5 py-2.5"
                  onSelect={() => {
                    if (n.link) navigate(n.link)
                  }}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-7 shrink-0 place-items-center rounded-[8px]',
                      TILE[n.kind] ?? TILE.daily,
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-[13px]',
                          n.read_at ? 'font-medium' : 'font-semibold',
                        )}
                      >
                        {n.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </span>
                    {n.body && (
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                        {n.body}
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
              )
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
