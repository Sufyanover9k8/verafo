import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2, Megaphone, Send, Users } from 'lucide-react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState, NeedsSetup } from '../components/States'
import { useIsAdmin } from '../lib/admin'
import { isConfigured, supabase } from '../lib/supabase'
import { timeAgo } from '../lib/format'
import { sendNotification } from '../lib/notifications'
import { useToast } from '../lib/toast'

/** Places a broadcast can point at. A free-text path would just be a typo farm. */
const LINKS = [
  { value: 'none', label: 'No link', path: null },
  { value: '/orders', label: 'Orders', path: '/orders' },
  { value: '/orders/pending', label: 'Outcomes', path: '/orders/pending' },
  { value: '/map', label: 'RTO Insights', path: '/map' },
  { value: '/import', label: 'Bulk Import', path: '/import' },
  { value: '/', label: 'Dashboard', path: '/' },
] as const

interface SentRow {
  id: string
  owner_email: string
  title: string
  body: string | null
  created_at: string
  read_at: string | null
}

export function Admin() {
  const toast = useToast()
  const { admin, checking } = useIsAdmin()

  const [audience, setAudience] = useState<'all' | 'one'>('all')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [link, setLink] = useState<string>('none')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<SentRow[]>([])

  const loadSent = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase
      .from('notifications')
      .select('id, owner_email, title, body, created_at, read_at')
      .eq('kind', 'admin')
      .order('created_at', { ascending: false })
      .limit(25)
    setSent((data ?? []) as SentRow[])
  }, [])

  useEffect(() => {
    if (!admin) return
    void loadSent()
  }, [admin, loadSent])

  async function onSend() {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      toast.push({ kind: 'error', title: 'Add a title', detail: 'The bell shows the title first.' })
      return
    }
    const target = email.trim()
    if (audience === 'one' && !target) {
      toast.push({ kind: 'error', title: 'Add a recipient', detail: 'Enter the email they sign in with.' })
      return
    }

    setSending(true)
    const res = await sendNotification({
      title: cleanTitle,
      body: body.trim() || undefined,
      link: LINKS.find((l) => l.value === link)?.path ?? undefined,
      all: audience === 'all',
      email: audience === 'one' ? target : undefined,
    })
    setSending(false)

    if (res.error) {
      toast.push({ kind: 'error', title: 'Could not send', detail: res.error })
      return
    }
    toast.push({
      kind: 'success',
      title: res.sent === 1 ? 'Notification sent' : `Notification sent to ${res.sent} people`,
      detail: audience === 'all' ? 'Every merchant and teammate has it in their bell.' : target,
    })
    setTitle('')
    setBody('')
    setLink('none')
    if (audience === 'one') setEmail('')
    void loadSent()
  }

  if (!isConfigured) return <NeedsSetup />

  return (
    <PageShell>
      <PageHeader
        title="Admin"
        description="Verafo team tools — message the merchants you serve."
      />

      {checking ? (
        <Card className="gap-0 p-5">
          <p className="text-[13px] text-muted-foreground">Checking your access…</p>
        </Card>
      ) : !admin ? (
        <Card className="gap-0 p-5">
          <EmptyState
            icon="shield-checkmark"
            title="Restricted to admins"
            detail="Only administrators can send notifications. Head back to the dashboard to continue."
            action={
              <Button asChild className="gap-2 rounded-full px-5">
                <Link to="/">
                  <ArrowRight className="size-4" /> Back to dashboard
                </Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
          <Card className="gap-4 p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent text-accent-foreground">
                <Megaphone className="size-4" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-[15.5px] font-semibold text-foreground">Send a notification</h2>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  Lands in the bell at the top of the page. Unread until they open it.
                </p>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="audience">Audience</Label>
              <Select value={audience} onValueChange={(v) => setAudience(v as 'all' | 'one')}>
                <SelectTrigger id="audience" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone — all merchants and teammates</SelectItem>
                  <SelectItem value="one">One person</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {audience === 'one' && (
              <div className="grid gap-1.5">
                <Label htmlFor="recipient">Recipient email</Label>
                <Input
                  id="recipient"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@brand.com"
                  autoComplete="off"
                />
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Scheduled maintenance tonight"
                maxLength={120}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Verafo will be read-only from 11pm to midnight PKT while we upgrade the risk engine."
                rows={4}
                maxLength={600}
                className="resize-y"
              />
              <p className="text-[11.5px] text-muted-foreground">
                Keep it short — the bell shows one line and truncates the rest.
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="link">Open when tapped</Label>
              <Select value={link} onValueChange={setLink}>
                <SelectTrigger id="link" className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINKS.map((l) => (
                    <SelectItem key={l.value} value={l.value}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <Users className="size-3.5" aria-hidden="true" />
                {audience === 'all' ? 'Goes to every store owner and admin' : 'Goes to one inbox'}
              </p>
              <Button className="gap-2 rounded-full px-5" disabled={sending} onClick={() => void onSend()}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {sending ? 'Sending…' : 'Send notification'}
              </Button>
            </div>
          </Card>

          <Card className="gap-0 overflow-hidden p-0">
            <div className="border-b border-border px-5 py-3.5">
              <h2 className="text-[15.5px] font-semibold text-foreground">Recently sent</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                One row per recipient, so read state stays personal.
              </p>
            </div>
            {sent.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
                Nothing sent yet.
              </p>
            ) : (
              <ul className="max-h-[26rem] divide-y divide-border overflow-y-auto">
                {sent.map((n) => (
                  <li key={n.id} className="px-5 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-foreground">
                        {n.title}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                      <span className="truncate font-mono">{n.owner_email}</span>
                      <span
                        className={
                          n.read_at
                            ? 'rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium'
                            : 'rounded-full bg-risk-watch-soft px-1.5 py-0.5 text-[11px] font-medium text-risk-watch-strong'
                        }
                      >
                        {n.read_at ? 'read' : 'unread'}
                      </span>
                    </div>
                    {n.body && (
                      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                        {n.body}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </PageShell>
  )
}
