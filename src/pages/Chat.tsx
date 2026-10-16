import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  CheckCheck,
  ClipboardList,
  Download,
  Loader2,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Square,
  Star,
  Trash2,
  TrendingUp,
  UserSearch,
  Users,
  X,
} from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { FileCard } from '../components/FileCard'
import { PageHeader } from '../components/app/page-header'
import { ChatMessageBubble, plainText } from '../components/app/chat-message'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Reveal } from '../components/Reveal'
import { EmptyHint } from '../components/app/empty-hint'
import { NeedsSetup } from '../components/States'
import { cn } from '@/lib/utils'
import { timeAgo } from '../lib/format'
import { activeMention, mentionPhones, type ActiveMention } from '../lib/mentions'
import { appendDelta, parseSseFrame, splitSseFrames, type SseFrame } from '../lib/sse'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import {
  AiError,
  aiFailureFromResponse,
  aiHeaders,
  aiJson,
  classifyAiThrow,
  type AiFailure,
} from '../lib/ai'
import { useToast } from '../lib/toast'
import type { AnalyzeReport, ChatMessage, ChatRow, FileSpec } from '../lib/types'

const FALLBACK_SUGGESTIONS = [
  'Should I ship an order to a buyer in my network?',
  'Show me the top 10 people who buy footwear',
  'Pie chart of my orders by store',
  'Which buyers are the biggest refusal risk?',
]

/**
 * The four things this page is actually for.
 *
 * Shown on an empty conversation instead of a bare "no messages" box: a blank
 * chat gives the merchant nothing to type and no clue what Verafo can see.
 * Each one pre-fills the composer rather than sending, so a click can never
 * spend a request on a question they did not mean to ask.
 */
const STARTERS = [
  {
    icon: UserSearch,
    label: 'Check a buyer',
    hint: 'Refusal history and usual order size',
    prompt: 'Check @ for me — refusal history, usual order size, and whether you would ship to them.',
  },
  {
    icon: MapPin,
    label: 'Look at a city',
    hint: 'Volume and returns by city',
    prompt: 'How many orders go to Karachi, and how many of them come back?',
  },
  {
    icon: Package,
    label: 'Rank a product',
    hint: 'Best sellers next to worst refusals',
    prompt: 'Which products sell best, and which ones get refused most?',
  },
  {
    icon: TrendingUp,
    label: 'Read the trend',
    hint: 'Orders and refusals over time',
    prompt: 'How have my orders and refusals moved over the last 8 weeks?',
  },
] as const

const QUICK_ACTIONS = [
  { key: 'analyze', label: 'Analyze buyer', icon: UserSearch },
  { key: 'trends', label: 'Trends', icon: TrendingUp },
  { key: 'suggest', label: 'Suggestions', icon: Sparkles },
  { key: 'topbuyers', label: 'Top buyers', icon: Users },
  { key: 'topproducts', label: 'Top products', icon: Package },
  { key: 'paste', label: 'Paste orders', icon: ClipboardList },
] as const

const FILTERS = [
  { label: 'Last 7 days', token: 'last 7 days' },
  { label: 'Last 30 days', token: 'last 30 days' },
  { label: 'Karachi', token: 'Karachi' },
  { label: 'Footwear', token: 'footwear' },
  { label: 'Pending only', token: 'pending orders only' },
] as const

/** Today / Previous 7 days / Older, so a long list reads as a timeline. */
function timeBucket(iso: string | null | undefined): string {
  if (!iso) return 'Older'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Older'
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  if (then >= startOfToday) return 'Today'
  if (Date.now() - then <= 7 * 86_400_000) return 'Previous 7 days'
  return 'Older'
}

/** Render order for the rail groups — newest bucket first. */
const CHAT_BUCKETS = ['Today', 'Previous 7 days', 'Older'] as const

function formatAnalyze(phone: string, r: AnalyzeReport): string {
  const lines = [
    `[Analyze] ${phone}`,
    `Verdict: ${r.verdict}`,
    `Recommendation: ${r.recommendation}`,
    `Confidence: ${r.confidence}`,
  ]
  if (r.risk_factors.length > 0) {
    lines.push('Risk factors:', ...r.risk_factors.map((f) => `- ${f}`))
  }
  if (r.positive_factors.length > 0) {
    lines.push('Positive factors:', ...r.positive_factors.map((f) => `- ${f}`))
  }
  return lines.join('\n')
}

interface TrendsReport {
  totals: {
    buyers: number
    orders: number
    accepted: number
    refused: number
    pending: number
    refusalRate: number
    avgOrderValue: number
  }
  riskBuckets: { safe: number; caution: number; high: number }
  topCategories: { category: string; count: number; refusalRate: number }[]
  topStores: { name: string; count: number }[]
  /** Masked labels only. The edge function no longer returns buyer phone
   *  numbers here, so this report cannot become a contact list. */
  riskiest: { buyer: string; risk_score: number; total_orders: number }[]
  weeklyTrend: { label: string; total: number; accepted: number; refused: number }[]
}

function formatTrends(t: TrendsReport): string {
  const lines = [
    '[Trends] Network snapshot',
    `${t.totals.buyers} buyers - ${t.totals.orders} orders - ${t.totals.accepted} accepted - ` +
      `${t.totals.refused} refused (${t.totals.refusalRate}%) - ${t.totals.pending} pending`,
    `Average order value ${t.totals.avgOrderValue.toLocaleString('en-PK')} PKR`,
    `Risk mix: ${t.riskBuckets.safe} safe - ${t.riskBuckets.caution} caution - ${t.riskBuckets.high} high`,
  ]
  lines.push('Orders per week:')
  for (const w of t.weeklyTrend) {
    lines.push(`- ${w.label}: ${w.total} orders (${w.accepted} accepted / ${w.refused} refused)`)
  }
  lines.push('Top categories:')
  for (const c of t.topCategories) {
    lines.push(`- ${c.category}: ${c.count} orders, ${c.refusalRate}% refused`)
  }
  lines.push('Top stores:')
  for (const s of t.topStores) {
    lines.push(`- ${s.name}: ${s.count} orders`)
  }
  lines.push('Riskiest buyers:')
  for (const b of t.riskiest) {
    lines.push(`- ${b.buyer}: risk ${b.risk_score.toFixed(2)}, ${b.total_orders} orders`)
  }
  return lines.join('\n')
}

interface ToolStep {
  id: number
  name: string
  label: string
  args: string
  status: 'running' | 'done' | 'error'
  summary?: string
}

interface WorkingState {
  phase: 'thinking' | 'understanding' | 'researching' | 'writing'
  label: string
  tools: ToolStep[]
}

/** The small print under the composer. Kept honest and short. */
const COMPOSER_HINT = 'Enter sends · Shift + Enter adds a line · @ for a buyer · # for a store'

/**
 * The four ways in, as cards.
 *
 * Defined outside `Chat` on purpose: a component created during render is a new
 * type on every pass, so React would unmount and remount the grid (losing focus
 * and hover) each time the composer changed.
 */
function StarterGrid({ onPick, disabled }: { onPick: (prompt: string) => void; disabled?: boolean }) {
  return (
    <div className="grid w-full gap-2 sm:grid-cols-2">
      {STARTERS.map((s) => (
        <button
          key={s.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(s.prompt)}
          className="group flex items-start gap-3 rounded-[14px] border border-border bg-card p-3 text-start transition-colors hover:border-[var(--teal)] hover:bg-[var(--bg-tint)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[var(--bg-tint)] text-[var(--v-safe-strong)] transition-colors group-hover:bg-card">
            <s.icon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-foreground">{s.label}</span>
            <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{s.hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function Chat() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [chats, setChats] = useState<ChatRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [composing, setComposing] = useState('')
  const [busy, setBusy] = useState(false)
  const [featureBusy, setFeatureBusy] = useState(false)
  const [working, setWorking] = useState<WorkingState | null>(null)
  /** The last turn that failed, so the thread can offer a way out instead of
   *  leaving an unanswered question behind a toast that already faded. */
  const [failure, setFailure] = useState<{ prompt: string; failure: AiFailure } | null>(null)
  const [streamText, setStreamText] = useState('')
  const [liveFiles, setLiveFiles] = useState<FileSpec[]>([])
  const [mention, setMention] = useState<ActiveMention | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionResults, setMentionResults] = useState<{ phone: string }[]>([])
  const [storeMentionResults, setStoreMentionResults] = useState<{ id: string; name: string }[]>([])
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_SUGGESTIONS)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [analyzePhone, setAnalyzePhone] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  /** On phones the rail is an overlay drawer; on desktop it is a column you can
   *  hide. One piece of state, steer the interaction by breakpoint at the moment
   *  the control is used, so a desktop toggle can never leave no way back. */
  const [railOpen, setRailOpen] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [manageMode, setManageMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLDivElement | null>(null)
  const mentionId = useRef(0)
  const toolStepId = useRef(0)
  const toolsUsedRef = useRef<string[]>([])
  const doneMsgIdRef = useRef<string | null>(null)
  /** Deltas as received, so the finished turn can be saved if the stream did not. */
  const streamedRef = useRef('')
  /** An `error` frame from the function, kept until the stream ends. */
  const streamErrorRef = useRef<string | null>(null)
  /** The in-flight answer, so the merchant can stop a runaway one. */
  const abortRef = useRef<AbortController | null>(null)
  /** Whether the merchant pressed Stop, rather than the watchdog firing. */
  const stoppedRef = useRef(false)
  const sendRef = useRef<((override?: string) => void) | null>(null)

  useEffect(() => {
    if (!quickOpen) return
    const onDown = (e: MouseEvent) => {
      if (composerRef.current && !composerRef.current.contains(e.target as Node)) {
        setQuickOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [quickOpen])

  const activeChat = chats.find((c) => c.id === activeId) ?? null

  const sortedChats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const list = chats.filter(
      (c) => !q || c.title.toLowerCase().includes(q) || (c.last_message ?? '').toLowerCase().includes(q),
    )
    return [...list].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return (
        new Date(b.last_message_at ?? b.created_at).getTime() - new Date(a.last_message_at ?? a.created_at).getTime()
      )
    })
  }, [chats, searchQuery])

  const loadChats = useCallback(async () => {
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('chats')
        .select('*')
        .order('last_message_at', { ascending: false, nullsFirst: false })
      if (error) throw error
      setChats(data ?? [])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({ kind: 'error', title: 'Could not load chats', detail: message })
    }
  }, [toast])

  const loadMessages = useCallback(async (chatId: string) => {
    if (!supabase) return
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
    if (error) throw error
    setMessages(data ?? [])
  }, [])

  const loadSuggestions = useCallback(async () => {
    if (!functionsBaseUrl()) return
    try {
      const j = await aiJson<{ suggestions?: string[] }>('suggest')
      if (Array.isArray(j.suggestions) && j.suggestions.length > 0) setSuggestions(j.suggestions)
    } catch {
      setSuggestions(FALLBACK_SUGGESTIONS)
    }
  }, [])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  useEffect(() => {
    if (chats.length > 0 && !activeId) setActiveId(chats[0].id)
  }, [chats, activeId])

  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    let cancelled = false
    setLoading(true)
    setWorking(null)
    setStreamText('')
    setLiveFiles([])
    setFailure(null)
    loadMessages(activeId)
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : String(err)
          toast.push({ kind: 'error', title: 'Could not load messages', detail: message })
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeId, loadMessages, toast])

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    loadSuggestions().catch(() => {
      if (!cancelled) setSuggestions(FALLBACK_SUGGESTIONS)
    })
    return () => {
      cancelled = true
    }
  }, [activeId, loadSuggestions])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [messages, activeId, loading, working, streamText])

  /**
   * A `?q=` in the URL prefills the composer but does NOT send. Buyer Lookup and
   * the dashboard link here with a question already written; the merchant still
   * gets to read and edit it before it costs a request, and an accidental link
   * can never fire a message on its own.
   */
  useEffect(() => {
    const q = params.get('q')
    if (!q) return
    setComposing(q)
    if (params.has('q') || params.has('phone')) setParams({}, { replace: true })
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }, [params, setParams])

  const fetchMentions = useCallback(async (query: string) => {
    if (!supabase) return
    const digits = query.replace(/[^\d]/g, '')
    // PRIVACY: this used to run `ilike('phone', '%digits%')`, which turned the
    // chat box into a phone-number enumeration endpoint — type a few digits
    // and harvest matching numbers. Two changes:
    //   · a minimum of 6 digits, so a partial probe returns nothing
    //   · the read now depends on the `buyers` policy, which is limited to
    //     this merchant's own buyers
    if (digits.length < 6) {
      setMentionResults([])
      return
    }
    const id = ++mentionId.current
    const { data, error } = await supabase.from('buyers').select('phone').ilike('phone', `%${digits}%`).limit(8)
    if (error || id !== mentionId.current) return
    setMentionResults((data ?? []) as { phone: string }[])
  }, [])

  const fetchStoreMentions = useCallback(async (query: string) => {
    if (!supabase) return
    const id = ++mentionId.current
    const { data, error } = await supabase.from('stores').select('id,name').ilike('name', `%${query}%`).limit(8)
    if (error || id !== mentionId.current) return
    setStoreMentionResults((data ?? []) as { id: string; name: string }[])
  }, [])

  useEffect(() => {
    if (!mention) {
      setMentionResults([])
      setStoreMentionResults([])
      return
    }
    if (mention.kind === 'store') void fetchStoreMentions(mention.query)
    else void fetchMentions(mention.query)
  }, [mention, fetchMentions, fetchStoreMentions])

  /** True on the narrow layout, where the rail is a drawer rather than a column. */
  function isNarrow() {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
  }

  async function newChat() {
    if (!supabase) return
    const { data, error } = await supabase.from('chats').insert({ title: 'New chat' }).select().single()
    if (error) {
      toast.push({ kind: 'error', title: 'Could not create chat', detail: error.message })
      return
    }
    setComposing('')
    setMention(null)
    setMessages([])
    setSuggestions(FALLBACK_SUGGESTIONS)
    setRenaming(false)
    setAnalyzeOpen(false)
    setSelected(new Set())
    setActiveId(data.id)
    await loadChats()
  }

  async function deleteChat(id: string) {
    if (!supabase) return
    const { error } = await supabase.from('chats').delete().eq('id', id)
    if (error) {
      toast.push({ kind: 'error', title: 'Could not delete chat', detail: error.message })
      return
    }
    if (activeId === id) {
      setActiveId(null)
      setMessages([])
    }
    await loadChats()
  }

  async function togglePin(c: ChatRow) {
    if (!supabase) return
    const next = !c.pinned
    const { error } = await supabase.from('chats').update({ pinned: next }).eq('id', c.id)
    if (error) {
      toast.push({ kind: 'error', title: 'Could not update pin', detail: error.message })
      return
    }
    await loadChats()
  }

  async function deleteSelected() {
    if (!supabase || selected.size === 0) return
    const ids = [...selected]
    const { error } = await supabase.from('chats').delete().in('id', ids)
    if (error) {
      toast.push({ kind: 'error', title: 'Could not delete chats', detail: error.message })
      return
    }
    if (activeId && selected.has(activeId)) {
      setActiveId(null)
      setMessages([])
    }
    setSelected(new Set())
    setManageMode(false)
    await loadChats()
  }

  async function deleteEmptyChats() {
    if (!supabase) return
    const { data, error } = await supabase.from('chats').select('id,title,last_message')
    if (error) return
    const empty = (data ?? []).filter((c) => !c.last_message).map((c) => c.id)
    if (empty.length === 0) {
      toast.push({ kind: 'success', title: 'No empty chats' })
      return
    }
    const { error: delErr } = await supabase.from('chats').delete().in('id', empty)
    if (delErr) {
      toast.push({ kind: 'error', title: 'Could not clean up', detail: delErr.message })
      return
    }
    if (activeId && empty.includes(activeId)) {
      setActiveId(null)
      setMessages([])
    }
    setSelected(new Set())
    toast.push({ kind: 'success', title: `Deleted ${empty.length} empty chat${empty.length === 1 ? '' : 's'}` })
    await loadChats()
  }

  function startRename() {
    if (!activeChat) return
    setRenameValue(activeChat.title)
    setRenaming(true)
  }

  async function saveRename() {
    if (!supabase || !activeChat) return
    const title = renameValue.trim() || 'New chat'
    const { error } = await supabase.from('chats').update({ title }).eq('id', activeChat.id)
    if (error) {
      toast.push({ kind: 'error', title: 'Could not rename chat', detail: error.message })
      return
    }
    setRenaming(false)
    await loadChats()
  }

  function handleComposeChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setComposing(value)
    setMention(activeMention(value, e.target.selectionStart ?? value.length))
    setMentionIndex(0)
  }

  function pickMention(value: string) {
    if (!mention) return
    const token = mention.kind === 'store' ? `#${value} ` : `@${value} `
    const next = composing.slice(0, mention.at) + token + composing.slice(mention.at + 1 + mention.query.length)
    setComposing(next)
    setMention(null)
    setMentionIndex(0)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  /** The rows currently offered by the @ / # picker. */
  const mentionRows: { key: string; value: string; label: string; name?: string; phone?: string }[] =
    mention == null
      ? []
      : mention.kind === 'store'
        ? storeMentionResults.map((s) => ({ key: s.id, value: s.name, label: s.name, name: s.name }))
        : mentionResults.map((b) => ({ key: b.phone, value: b.phone, label: b.phone, phone: b.phone }))

  function handleComposeKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && mentionRows.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionRows.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionRows.length) % mentionRows.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(mentionRows[Math.min(mentionIndex, mentionRows.length - 1)].value)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendRef.current?.()
    } else if (e.key === 'Escape') {
      setMention(null)
    }
  }

  /**
   * One parsed frame from the answer stream.
   *
   * `useCallback` with no dependencies because everything it touches is either a
   * ref or a state setter, both of which React keeps stable — so `send`, which
   * calls it, does not have to be rebuilt on every render.
   */
  const dispatchSseFrame = useCallback(({ event, data: payload }: SseFrame) => {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(payload)
    } catch {
      return
    }
    switch (event) {
      case 'phase': {
        const phase = String(data.phase ?? 'thinking')
        setWorking((w) => ({
          phase: (['understanding', 'researching', 'writing'].includes(phase)
            ? phase
            : 'thinking') as WorkingState['phase'],
          label: String(data.label ?? 'Working…'),
          tools: w?.tools ?? [],
        }))
        break
      }
      case 'tool_call': {
        const id = ++toolStepId.current
        const name = String(data.name ?? 'tool')
        toolsUsedRef.current.push(name)
        setWorking((w) => ({
          phase: w?.phase ?? 'researching',
          label: w?.label ?? 'Researching your data…',
          tools: [
            ...(w?.tools ?? []),
            {
              id,
              name,
              label: String(data.label ?? 'Running tool'),
              args: String(data.args ?? ''),
              status: 'running',
            },
          ],
        }))
        break
      }
      case 'tool_result': {
        const name = String(data.name ?? '')
        const ok = !data.error
        setWorking((w) => ({
          phase: w?.phase ?? 'researching',
          label: w?.label ?? 'Researching your data…',
          tools: (w?.tools ?? []).map((t) =>
            t.name === name && t.status === 'running'
              ? { ...t, status: ok ? ('done' as const) : ('error' as const), summary: String(data.summary ?? '') }
              : t,
          ),
        }))
        break
      }
      case 'delta': {
        const content = String(data.content ?? '')
        if (content) {
          /*
           * The buffer is appended HERE, not inside the `setStreamText`
           * updater: a React updater must be pure. React invokes updaters more
           * than once — twice under StrictMode, and again whenever a concurrent
           * render is discarded — so accumulating in one interleaved the same
           * delta into the buffer several times and every saved answer came out
           * with its chunks duplicated. The updater below only adds, and adding
           * the same string twice to discarded state is harmless.
           */
          streamedRef.current = appendDelta(streamedRef.current, content)
          setStreamText((t) => t + content)
          setWorking((w) =>
            w ? { ...w, phase: 'writing', label: w.label } : { phase: 'writing', label: 'Writing your answer…', tools: [] },
          )
        }
        break
      }
      case 'file': {
        try {
          const spec = data.spec as FileSpec
          if (spec && Array.isArray(spec.columns) && Array.isArray(spec.rows)) {
            setLiveFiles((fs) => [...fs, spec])
          }
        } catch {
          /* ignore malformed file event */
        }
        break
      }
      case 'done': {
        doneMsgIdRef.current = data.message_id ? String(data.message_id) : null
        break
      }
      case 'error': {
        /*
         * Recorded rather than thrown. The function reports its own failures
         * mid-stream, after it has already sent phases and — sometimes — part
         * of an answer. Throwing from here would abandon whatever had already
         * arrived, and the merchant would watch a half-written reply vanish.
         */
        streamErrorRef.current = String(data.message ?? 'Verafo hit an error')
        break
      }
    }
  }, [])

  const handleSseEvent = useCallback(
    (block: string) => {
      const frame = parseSseFrame(block)
      if (frame) dispatchSseFrame(frame)
    },
    [dispatchSseFrame],
  )

  const persistCitations = useCallback(async () => {
    const mid = doneMsgIdRef.current
    const tools = toolsUsedRef.current
    if (!supabase || !mid || tools.length === 0) return
    const { data } = await supabase.from('chat_messages').select('content').eq('id', mid).single()
    if (!data || data.content.includes('[[CITES]]')) return
    const cites = `\n\n[[CITES]]${tools.join('|')}[[/CITES]]`
    await supabase.from('chat_messages').update({ content: data.content + cites }).eq('id', mid)
  }, [])

  /**
   * Safety net for the case the backend did not store the assistant turn.
   *
   * The verafo-ai function inserts the assistant row and puts its id in the
   * `done` frame; the composer then reloads the thread from `chat_messages`. If
   * the row is absent the answer would vanish the moment it finished arriving.
   *
   * The guard is the `done` frame's message id, NOT a read of the row: the
   * function sends an id on every successful turn, and a missing id means it
   * did not write, so a client-side save is strictly better than losing the
   * answer. Reading the row instead would race the function's own insert and
   * could write a second copy, so it is deliberately not done. In normal
   * operation this is a single no-op check.
   */
  const persistAssistantTurn = useCallback(
    async (chatId: string) => {
      const text = streamedRef.current
      if (!supabase || !text) return
      if (doneMsgIdRef.current) return // the function stored it; never write again
      await supabase.from('chat_messages').insert({ chat_id: chatId, role: 'assistant', content: text, phone: null })
    },
    [],
  )

  const send = useCallback(
    async (override?: string) => {
      const raw = (override ?? composing).trim()
      if (!supabase || !activeId || !raw || busy) return
      const phones = mentionPhones(raw)
      const phone = phones[0] ?? activeChat?.phone ?? null
      setBusy(true)
      setFailure(null)
      setComposing('')
      setMention(null)
      setStreamText('')
      setLiveFiles([])
      setWorking({ phase: 'thinking', label: 'Thinking…', tools: [] })
      toolsUsedRef.current = []
      doneMsgIdRef.current = null
      streamedRef.current = ''
      streamErrorRef.current = null
      const optimisticId = `tmp-${Date.now()}`
      setMessages((m) => [
        ...m,
        {
          id: optimisticId,
          chat_id: activeId,
          role: 'user',
          content: raw,
          phone,
          created_at: new Date().toISOString(),
        },
      ])
      const dropOptimistic = () => setMessages((m) => m.filter((x) => x.id !== optimisticId))
      try {
        const { error: insErr } = await supabase
          .from('chat_messages')
          .insert({ chat_id: activeId, role: 'user', content: raw, phone })
        if (insErr) {
          /*
           * The question never reached the thread. Showing it as sent would
           * leave the merchant waiting for an answer to something Verafo never
           * received, so the bubble comes back out and the text returns to the
           * composer.
           */
          dropOptimistic()
          setComposing(raw)
          throw new AiError(classifyAiThrow(insErr))
        }
        if (phone && !activeChat?.phone) {
          await supabase.from('chats').update({ phone }).eq('id', activeId)
        }
        if (!functionsBaseUrl()) {
          throw new AiError({
            kind: 'config',
            title: 'Verafo AI is not configured',
            detail: 'This build has no Supabase URL, so the AI function cannot be called.',
          })
        }
        const ac = new AbortController()
        abortRef.current = ac
        const res = await fetch(`${functionsBaseUrl()}/verafo-ai`, {
          method: 'POST',
          headers: await aiHeaders(),
          signal: ac.signal,
          body: JSON.stringify({ action: 'chat', chat_id: activeId, prompt: raw, phone: phone ?? undefined }),
        })
        if (!res.ok || !res.body) throw new AiError(await aiFailureFromResponse(res))

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let done = false
        /*
         * A watchdog on the gaps, not on the whole answer: a long reply is
         * allowed to stream for as long as it needs, but a connection that goes
         * quiet for 90 seconds is dead, and leaving the composer spinning on it
         * is what "Verafo is not responding" looks like.
         */
        let watchdog: ReturnType<typeof setTimeout> | null = null
        const armWatchdog = () => {
          if (watchdog) clearTimeout(watchdog)
          watchdog = setTimeout(() => ac.abort(), 90_000)
        }
        try {
          armWatchdog()
          while (!done) {
            const { value, done: streamDone } = await reader.read()
            done = streamDone
            armWatchdog()
            buf += decoder.decode(value ?? new Uint8Array(), { stream: !done })
            const { frames, rest } = splitSseFrames(buf)
            buf = rest
            for (const frame of frames) {
              if (streamErrorRef.current) break
              dispatchSseFrame(frame)
            }
            if (streamErrorRef.current) break
          }
          if (buf.trim() && !streamErrorRef.current) handleSseEvent(buf)
        } finally {
          if (watchdog) clearTimeout(watchdog)          // The function may have more frames queued behind the failure; let the
          // connection go rather than reading a stream nobody is listening to.
          if (streamErrorRef.current || ac.signal.aborted) {
            await reader.cancel().catch(() => undefined)
          }
        }

        if (streamErrorRef.current) {
          if (streamedRef.current) {
            /*
             * Part of an answer did arrive. Keeping it — clearly marked as
             * unfinished — beats deleting it: the merchant can still read what
             * Verafo worked out, and can ask again for the rest.
             */
            await persistAssistantTurn(activeId)
            setFailure({
              prompt: raw,
              failure: {
                kind: 'server',
                title: 'That answer was cut short',
                detail: streamErrorRef.current,
                retryable: true,
              },
            })
            await Promise.all([loadMessages(activeId), loadChats()])
            return
          }
          throw new Error(streamErrorRef.current)
        }

        await persistCitations()
        await persistAssistantTurn(activeId)
        await Promise.all([loadMessages(activeId), loadChats()])
        void loadSuggestions()
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === 'AbortError'
        if (aborted && streamedRef.current) {
          // Stopped, either by the merchant or by the watchdog. Whatever had
          // arrived is kept — it is usually most of the answer.
          await persistAssistantTurn(activeId)
          const byMerchant = stoppedRef.current
          setFailure({
            prompt: raw,
            failure: {
              kind: 'timeout',
              title: byMerchant ? 'Answer stopped' : 'That answer was cut short',
              detail: byMerchant
                ? 'You stopped Verafo. What had already arrived was kept — ask again for the rest.'
                : 'The connection went quiet before the answer finished. What had already arrived was kept.',
              retryable: true,
            },
          })
          await Promise.all([loadMessages(activeId), loadChats()])
          return
        }
        if (aborted) {
          throw new AiError({
            kind: 'timeout',
            title: stoppedRef.current ? 'Answer stopped' : 'Verafo went quiet',
            detail: stoppedRef.current
              ? 'You stopped Verafo before it answered.'
              : 'No answer arrived for 90 seconds, so the request was closed. Try again, or ask something narrower.',
          })
        }
        const failure = classifyAiThrow(err)
        /*
         * The failure is shown in the thread as well as in a toast. A toast
         * disappears after a few seconds and leaves the question sitting there
         * unanswered, which is exactly what "Verafo is not responding" looks
         * like from the merchant's side.
         */
        setFailure({ prompt: raw, failure })
        toast.push({ kind: 'error', title: failure.title, detail: failure.detail })
        try {
          await loadMessages(activeId)
        } catch {
          /* keep the optimistic bubble */
        }
      } finally {
        abortRef.current = null
        stoppedRef.current = false
        setBusy(false)
        setWorking(null)
        setStreamText('')
        setLiveFiles([])
        doneMsgIdRef.current = null
        toolsUsedRef.current = []
        streamErrorRef.current = null
      }
    },
    [
      composing,
      busy,
      activeId,
      activeChat,
      toast,
      loadMessages,
      loadChats,
      loadSuggestions,
      persistCitations,
      persistAssistantTurn,
      handleSseEvent,
      dispatchSseFrame,
    ],
  )

  // The keyboard handler lives on the textarea. Keeping the latest `send` in a
  // ref means Enter-to-send never calls a stale copy, and the ref is written in
  // an effect rather than during render.
  useEffect(() => {
    sendRef.current = (override?: string) => void send(override)
  }, [send])

  async function appendAssistant(content: string) {
    if (!supabase || !activeId) return
    const { error } = await supabase
      .from('chat_messages')
      .insert({ chat_id: activeId, role: 'assistant', content, phone: activeChat?.phone })
    if (error) throw error
    await Promise.all([loadMessages(activeId), loadChats()])
  }

  async function runAnalyze(e: FormEvent) {
    e.preventDefault()
    const phone = analyzePhone.trim()
    if (!supabase || !activeId || !phone || featureBusy) return
    if (!functionsBaseUrl()) return
    setFeatureBusy(true)
    try {
      const json = await aiJson<{ report?: AnalyzeReport }>('analyze', { phone })
      if (!json.report) throw new AiError({ kind: 'server', title: 'Analysis failed' })
      await appendAssistant(formatAnalyze(phone, json.report))
      setAnalyzeOpen(false)
      setAnalyzePhone('')
    } catch (err) {
      const failure = classifyAiThrow(err)
      toast.push({ kind: 'error', title: 'Analysis failed', detail: failure.detail })
    } finally {
      setFeatureBusy(false)
    }
  }

  async function runTrends() {
    if (!supabase || !activeId || featureBusy) return
    if (!functionsBaseUrl()) return
    setFeatureBusy(true)
    try {
      const json = await aiJson<{ totals?: unknown }>('trends')
      if (!json.totals) throw new AiError({ kind: 'server', title: 'Trends failed' })
      await appendAssistant(formatTrends(json as unknown as TrendsReport))
    } catch (err) {
      const failure = classifyAiThrow(err)
      toast.push({ kind: 'error', title: 'Trends failed', detail: failure.detail })
    } finally {
      setFeatureBusy(false)
    }
  }

  async function runSuggest() {
    if (!supabase || !activeId || featureBusy) return
    if (!functionsBaseUrl()) return
    setFeatureBusy(true)
    try {
      const json = await aiJson<{ suggestions?: string[] }>('suggest')
      if (!Array.isArray(json.suggestions)) throw new AiError({ kind: 'server', title: 'Suggestions failed' })
      await appendAssistant(['[Suggestions] Things to try', ...json.suggestions.map((s) => `- ${s}`)].join('\n'))
    } catch (err) {
      const failure = classifyAiThrow(err)
      toast.push({ kind: 'error', title: 'Suggestions failed', detail: failure.detail })
    } finally {
      setFeatureBusy(false)
    }
  }

  /** Stop the answer in flight. Whatever already arrived is kept. */
  function stopAnswer() {
    stoppedRef.current = true
    abortRef.current?.abort()
  }

  /**
   * Re-ask the question that failed.
   *
   * The failed exchange is removed first — the question and, if the answer was
   * cut short, the fragment that was saved with it — so retrying re-asks the
   * question once instead of leaving two copies of it in the thread.
   */
  async function retryFailure() {
    if (!failure || !supabase || !activeId || busy) return
    const prompt = failure.prompt
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUser && !lastUser.id.startsWith('tmp-') && lastUser.content.trim() === prompt.trim()) {
      const at = messages.findIndex((m) => m.id === lastUser.id)
      const doomed = messages
        .slice(at)
        .filter((m) => !m.id.startsWith('tmp-'))
        .map((m) => m.id)
      if (doomed.length > 0) await supabase.from('chat_messages').delete().in('id', doomed)
    }
    setFailure(null)
    await loadMessages(activeId).catch(() => undefined)
    void send(prompt)
  }

  function handleQuickAction(key: (typeof QUICK_ACTIONS)[number]['key']) {    if (busy || featureBusy) return
    if (key === 'analyze') {
      setAnalyzeOpen((v) => !v)
    } else if (key === 'trends') {
      setQuickOpen(false)
      void runTrends()
    } else if (key === 'suggest') {
      setQuickOpen(false)
      void runSuggest()
    } else if (key === 'topbuyers') {
      setQuickOpen(false)
      void send('Show me the top 10 buyers by spend.')
    } else if (key === 'topproducts') {
      setQuickOpen(false)
      void send('Show me the top products by revenue.')
    } else if (key === 'paste') {
      setQuickOpen(false)
      setPasteOpen(true)
    }
  }

  function submitPaste(e: FormEvent) {
    e.preventDefault()
    const t = pasteText.trim()
    if (!t) return
    setPasteOpen(false)
    setPasteText('')
    void send(`Log these orders and check the buyers:\n${t}`)
  }

  function applyFilter(token: string) {
    const next = composing.trim() ? `${composing} ${token}` : token
    setComposing(next)
    setQuickOpen(false)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function exportChat() {
    if (messages.length === 0) return
    const lines = messages.map((m) => {
      const txt = plainText(m.content)
      const label = m.role === 'user' ? 'You' : 'Verafo'
      const who = m.phone ? ` (${m.phone})` : ''
      const stamp = new Date(m.created_at).toLocaleString('en-GB')
      return `[${label}${who}] ${stamp}\n${txt}\n`
    })
    const blob = new Blob(
      [`Ask Verafo — ${activeChat?.title ?? 'Chat'}\n${'='.repeat(40)}\n\n${lines.join('\n')}`],
      { type: 'text/plain;charset=utf-8' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'verafo-chat.txt'
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
    toast.push({ kind: 'success', title: 'Chat exported' })
  }

  async function copyChat() {
    if (messages.length === 0) return
    const text = messages
      .map(
        (m) => `[${m.role === 'user' ? 'You' : 'Verafo'}${m.phone ? ` (${m.phone})` : ''}]\n${plainText(m.content)}`,
      )
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.push({ kind: 'success', title: 'Chat copied' })
    } catch {
      toast.push({ kind: 'error', title: 'Could not copy chat' })
    }
  }

  if (!isConfigured) return <NeedsSetup />

  const canSend = Boolean(activeChat) && composing.trim().length > 0 && !busy
  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant'

  return (
    <>
      <PageHeader
        title="Ask Verafo"
        description="Questions answered against your own order data — not a general chatbot."
        actions={
          <Button size="sm" className="h-11 gap-1.5 md:h-9" onClick={() => void newChat()}>
            <Plus className="size-4" /> New chat
          </Button>
        }
      />

      {/*
       * A DEFINITE height, not a minimum.
       *
       * With only `min-h`, the grid row sized itself to its content: the
       * conversation rail's `overflow-y-auto` never engaged (a scroll region
       * needs a definite height), so a long conversation list stretched the row
       * downward and pushed the chat window out of the viewport entirely.
       * `h-*` makes both columns definite, so each scrolls inside its own box
       * and the composer stays on screen.
       */}
      <div className="grid h-[calc(100dvh-var(--v-topbar-h)-9rem)] min-h-[30rem] gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── Conversation rail: a column on desktop, a drawer on phones ── */}
        <aside
          className={cn(
            // `min-w-0` matters: without it the search input's min-content width
            // set the column, and on a phone the rail grew wider than the screen
            // instead of shrinking with it.
            'flex min-h-0 min-w-0 flex-col gap-3 rounded-[16px] border border-border bg-card p-4',
            /*
             * Phones: an overlay drawer, not a second row.
             *
             * Sharing one fixed-height grid with the conversation gave the rail
             * and the transcript half the screen each, which left the composer
             * unusably short. The floating "Chats" button and the drawer's close
             * button already assume an overlay, so this is what they expect.
             */
            'max-lg:fixed max-lg:top-[var(--v-topbar-h)] max-lg:bottom-0 max-lg:start-0 max-lg:z-40 max-lg:h-auto max-lg:w-[min(20rem,86vw)] max-lg:rounded-s-none max-lg:shadow-3',
            'lg:h-full lg:static lg:z-auto lg:w-auto',
            !railOpen && 'hidden',
          )}
          aria-label="Your conversations"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-foreground">
              <MessageSquare className="size-4 shrink-0 text-primary-text" aria-hidden="true" />
              <span className="truncate">Conversations</span>
            </h2>
            <Button
              size="icon"
              variant="ghost"
              className="size-11 shrink-0 md:size-9 lg:hidden"
              aria-label="Hide conversations"
              onClick={() => setRailOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats"
              aria-label="Search chats"
              className="h-11 ps-8 md:h-9"
            />
          </div>

          {manageMode && (
            <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border bg-muted/50 p-2">
              <Button
                size="sm"
                variant="outline"
                className="h-11 px-3 md:h-8"
                onClick={() =>
                  setSelected(selected.size === sortedChats.length ? new Set() : new Set(sortedChats.map((c) => c.id)))
                }
              >
                {selected.size === sortedChats.length ? 'None' : 'All'}
              </Button>
              <Button size="sm" variant="outline" className="h-11 px-3 md:h-8" onClick={() => void deleteEmptyChats()}>
                Empty
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="h-11 px-3 md:h-8"
                disabled={selected.size === 0}
                onClick={() => void deleteSelected()}
              >
                <Trash2 className="size-3.5" /> Delete ({selected.size})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-11 px-3 md:h-8"
                onClick={() => {
                  setManageMode(false)
                  setSelected(new Set())
                }}
              >
                Done
              </Button>
            </div>
          )}

          <Reveal stagger className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {sortedChats.length === 0 && (
              <div className="py-4">
                <EmptyHint
                  title={searchQuery ? 'No matches' : 'No chats yet'}
                  detail={searchQuery ? 'Try a different search.' : 'Start a conversation to get going.'}
                />
              </div>
            )}
            {CHAT_BUCKETS.map((bucket) => {
              const rows = sortedChats.filter(
                (c) => timeBucket(c.last_message_at ?? c.created_at) === bucket,
              )
              if (rows.length === 0) return null
              return (
                <div key={bucket} className="flex flex-col gap-1">
                  <p className="px-2 pt-2 pb-0.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {bucket}
                  </p>
                  {rows.map((c) => {
                    const active = activeId === c.id
                    const empty = !c.last_message
                    return (
                      <div
                        key={c.id}
                        className={cn(
                          'group/row flex items-start gap-2 rounded-[10px] border px-2 py-2 transition-colors',
                          active
                            ? 'border-border bg-muted'
                            : empty
                              ? 'border-transparent hover:bg-muted/50'
                              : 'border-transparent hover:bg-muted/60',
                        )}
                      >
                        {manageMode && (
                          <input
                            type="checkbox"
                            className="mt-1.5 size-4 shrink-0 accent-[var(--teal)]"
                            checked={selected.has(c.id)}
                            onChange={() =>
                              setSelected((s) => {
                                const next = new Set(s)
                                if (next.has(c.id)) next.delete(c.id)
                                else next.add(c.id)
                                return next
                              })
                            }
                            aria-label={`Select ${c.title}`}
                          />
                        )}
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-start"
                          aria-current={active ? 'true' : undefined}
                          onClick={() => {
                            setRenaming(false)
                            setAnalyzeOpen(false)
                            setActiveId(c.id)
                            // On a phone the drawer has done its job once a chat is
                            // open. On desktop the column stays where it is.
                            if (isNarrow()) setRailOpen(false)
                          }}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-foreground">
                              {c.title}
                            </span>
                            <span className="shrink-0 text-[11.5px] text-muted-foreground">
                              {timeAgo(c.last_message_at ?? c.created_at)}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'mt-0.5 block truncate text-[12px]',
                              empty ? 'text-muted-foreground/70 italic' : 'text-muted-foreground',
                            )}
                          >
                            {c.last_message ?? 'Empty — not asked yet'}
                          </span>
                          {c.phone && (
                            <span className="mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-primary-text">
                              {c.phone}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          className={cn(
                            'mt-0.5 grid size-8 shrink-0 place-items-center rounded-[10px] transition-colors hover:bg-card',
                            c.pinned
                              ? 'text-risk-watch-strong'
                              : 'text-muted-foreground/60 hover:text-foreground',
                          )}
                          title={c.pinned ? 'Unpin' : 'Pin conversation'}
                          aria-pressed={Boolean(c.pinned)}
                          onClick={() => void togglePin(c)}
                        >
                          <Star className={cn('size-3.5', c.pinned && 'fill-current')} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </Reveal>

          <div className="border-t border-border pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="h-11 w-full justify-start gap-2 md:h-9"
              onClick={() => setManageMode((v) => !v)}
            >
              {manageMode ? <X className="size-3.5" /> : <CheckCheck className="size-3.5" />}
              {manageMode ? 'Exit manage' : 'Manage chats'}
            </Button>
          </div>
        </aside>

        {/* ── The conversation ── */}
        <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[16px] border border-border bg-card">
          {!activeChat ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6">
              <EmptyHint
                large
                title="No conversation open"
                detail="Pick one from the list, or start a new chat to ask about buyers, orders or refusals."
                action={
                  <Button onClick={() => void newChat()} className="h-11">
                    <Plus className="size-4" /> New chat
                  </Button>
                }
              />
              <div className="w-full max-w-xl">
                <p className="mb-2 text-center text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                  What you can ask
                </p>
                <StarterGrid
                  disabled={busy}
                  onPick={(prompt) => {
                    void newChat().then(() => setComposing(prompt))
                  }}
                />
              </div>
              <Button
                variant="outline"
                className="h-11 lg:hidden"
                onClick={() => setRailOpen(true)}
              >
                <MessageSquare className="size-4" /> Show conversations
              </Button>
            </div>
          ) : (
            <>
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 md:size-9 lg:hidden"
                    aria-label="Show conversations"
                    onClick={() => setRailOpen(true)}
                  >
                    <MessageSquare className="size-4" />
                  </Button>
                  <div className="min-w-0">
                    {renaming ? (
                      <input
                        className="h-9 w-full max-w-xs rounded-[10px] border border-input bg-card px-2 text-[15px] font-semibold text-foreground"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void saveRename()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveRename()
                          else if (e.key === 'Escape') setRenaming(false)
                        }}
                        autoFocus
                        aria-label="Chat title"
                      />
                    ) : (
                      <h2
                        className="truncate text-[15px] font-semibold text-foreground"
                        title="Double-click to rename"
                        onDoubleClick={startRename}
                      >
                        {activeChat.title}
                      </h2>
                    )}
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                      {activeChat.phone && <span className="font-mono text-primary-text">{activeChat.phone}</span>}
                      <span>
                        {messages.length} message{messages.length === 1 ? '' : 's'}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hidden size-9 lg:inline-flex"
                    title={railOpen ? 'Hide the conversation list' : 'Show the conversation list'}
                    aria-label={railOpen ? 'Hide the conversation list' : 'Show the conversation list'}
                    aria-pressed={railOpen}
                    onClick={() => setRailOpen((v) => !v)}
                  >
                    <MessageSquare className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 md:size-9"
                    title="Copy chat"
                    aria-label="Copy chat"
                    onClick={() => void copyChat()}
                  >
                    <CheckCheck className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 md:size-9"
                    title="Export chat (.txt)"
                    aria-label="Export chat"
                    onClick={exportChat}
                  >
                    <Download className="size-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-11 md:size-9" aria-label="More chat actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onSelect={startRename}>
                        <Pencil className="size-4" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void togglePin(activeChat)}>
                        <Star className="size-4" /> {activeChat.pinned ? 'Unpin' : 'Pin'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void deleteChat(activeChat.id)}>
                        <Trash2 className="size-4" /> Delete chat
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </header>

              <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
                {loading && (
                  <div className="flex flex-col gap-3" aria-hidden="true">
                    <div className="h-16 w-3/5 animate-pulse rounded-[16px] bg-muted" />
                    <div className="h-24 w-4/5 animate-pulse rounded-[16px] bg-muted" />
                  </div>
                )}

                {!loading && messages.length === 0 && (
                  <div className="m-auto flex w-full max-w-xl flex-col items-center gap-4 py-4">
                    <span className="grid size-11 place-items-center rounded-[14px] bg-[var(--bg-tint)] text-[var(--v-safe-strong)]">
                      <Sparkles className="size-5" aria-hidden="true" />
                    </span>
                    <div className="text-center">
                      <p className="font-display text-[19px] leading-tight text-foreground">
                        Ask Verafo about your own orders
                      </p>
                      <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
                        Verafo reads this store's buyers, orders and refusals before it answers. Mention a buyer
                        with @ or a store with #.
                      </p>
                    </div>
                    <StarterGrid
                      disabled={busy || !activeChat}
                      onPick={(prompt) => {
                        setComposing(prompt)
                        window.setTimeout(() => textareaRef.current?.focus(), 0)
                      }}
                    />
                  </div>
                )}

                {messages.map((m) => (
                  <ChatMessageBubble key={m.id} msg={m} />
                ))}

                {failure && !busy && (
                  <div className="flex max-w-[min(52rem,94%)] flex-col gap-2 self-start">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-[var(--v-watch-strong)] uppercase">
                      <AlertTriangle className="size-3.5" aria-hidden="true" /> Not answered
                    </span>
                    <div
                      className="rounded-[16px] rounded-es-[4px] border border-s-[3px] border-[var(--v-watch-bar)] bg-[var(--v-watch-bg)] px-4 py-3.5"
                      role="alert"
                    >
                      <p className="text-[14px] font-semibold text-foreground">{failure.failure.title}</p>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
                        {failure.failure.detail}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {failure.failure.retryable && (
                          <Button size="sm" className="h-11 md:h-8" onClick={() => void retryFailure()}>
                            <RotateCcw className="size-3.5" /> Try again
                          </Button>
                        )}
                        {failure.failure.kind === 'session' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-11 md:h-8"
                            onClick={() => navigate('/login')}
                          >
                            Sign in again
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-11 md:h-8"
                          onClick={() => {
                            setFailure(null)
                            setComposing(failure.prompt)
                            window.setTimeout(() => textareaRef.current?.focus(), 0)
                          }}
                        >
                          <Pencil className="size-3.5" /> Edit the question
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-11 md:h-8"
                          onClick={() => setFailure(null)}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {working && (
                  <div className="flex max-w-[min(52rem,94%)] flex-col gap-2 self-start">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-primary-text uppercase">
                      <Sparkles className="size-3.5" aria-hidden="true" /> Verafo
                    </span>
                    <div
                      className="flex flex-col gap-3 rounded-[16px] rounded-es-[4px] border border-s-[3px] border-border bg-card px-4 py-3.5"
                      role="status"
                      aria-live="polite"
                    >
                      <p className="flex items-center gap-2 text-[13.5px] font-medium text-foreground">
                        <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                        {working.label}
                      </p>

                      {working.tools.length > 0 && (
                        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                          {working.tools.map((t) => (
                            <li key={t.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12.5px]">
                              <span
                                className={cn(
                                  'inline-grid size-4 shrink-0 place-items-center rounded-full',
                                  t.status === 'error'
                                    ? 'bg-risk-high-soft text-risk-high-strong'
                                    : t.status === 'done'
                                      ? 'bg-risk-safe-soft text-risk-safe-strong'
                                      : 'text-muted-foreground',
                                )}
                                aria-hidden="true"
                              >
                                {t.status === 'running' ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : t.status === 'done' ? (
                                  <Check className="size-3" />
                                ) : (
                                  <X className="size-3" />
                                )}
                              </span>
                              <span className="text-foreground">{t.label}</span>
                              {t.args && <span className="font-mono text-[11.5px] text-muted-foreground">({t.args})</span>}
                              {t.summary && <span className="text-muted-foreground">{t.summary}</span>}
                            </li>
                          ))}
                        </ul>
                      )}

                      {liveFiles.map((f, i) => (
                        <FileCard key={`live-${i}`} spec={f} />
                      ))}

                      {streamText && (
                        <div className="text-[14px] leading-relaxed whitespace-pre-wrap text-foreground">
                          {streamText}
                          <span className="ms-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-text-bottom" />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {lastIsAssistant && !busy && !working && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                      <Sparkles className="size-3.5" aria-hidden="true" /> Follow up
                    </span>
                    {suggestions.slice(0, 3).map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="h-11 max-w-full truncate rounded-full border border-border bg-card px-3 text-[12.5px] text-foreground transition-colors hover:bg-muted md:h-8"
                        onClick={() => {
                          setComposing(s)
                          window.setTimeout(() => textareaRef.current?.focus(), 0)
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <footer className="border-t border-border px-4 pt-3 pb-4">
                <div ref={composerRef} className="relative flex items-end gap-2">
                  <div className="relative shrink-0">
                    <Button
                      variant={quickOpen ? 'secondary' : 'outline'}
                      size="icon"
                      className="size-11"
                      title="Quick options"
                      aria-label="Quick options"
                      aria-expanded={quickOpen}
                      onClick={() => setQuickOpen((v) => !v)}
                    >
                      <Plus className="size-5" />
                    </Button>

                    {quickOpen && (
                      <div className="absolute bottom-[3.25rem] start-0 z-40 w-[min(20rem,calc(100vw-2rem))] rounded-[16px] border border-border bg-popover p-3 shadow-3">
                        <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                          Instant reports
                        </p>
                        <div className="grid grid-cols-2 gap-1.5">
                          {QUICK_ACTIONS.map((a) => (
                            <button
                              key={a.key}
                              type="button"
                              className="flex h-11 items-center gap-2 rounded-[10px] px-2.5 text-start text-[13px] text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                              disabled={busy || featureBusy}
                              onClick={() => handleQuickAction(a.key)}
                            >
                              <a.icon className="size-4 shrink-0 text-primary-text" aria-hidden="true" />
                              {a.label}
                            </button>
                          ))}
                        </div>

                        <p className="mt-3 mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                          Add to your question
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {FILTERS.map((f) => (
                            <button
                              key={f.label}
                              type="button"
                              className="h-11 rounded-full border border-border px-3 text-[12.5px] text-foreground transition-colors hover:bg-muted md:h-8"
                              onClick={() => applyFilter(f.token)}
                            >
                              {f.label}
                            </button>
                          ))}
                        </div>

                        {analyzeOpen && (
                          <form className="mt-3 flex items-end gap-2 border-t border-border pt-3" onSubmit={(e) => void runAnalyze(e)}>
                            <div className="min-w-0 flex-1">
                              <label
                                htmlFor="analyze-phone"
                                className="mb-1 block text-[11.5px] font-medium text-muted-foreground"
                              >
                                Buyer phone number
                              </label>
                              <input
                                id="analyze-phone"
                                type="tel"
                                inputMode="tel"
                                value={analyzePhone}
                                onChange={(e) => setAnalyzePhone(e.target.value)}
                                placeholder="+92 3xx xxxxxxx"
                                className="h-11 w-full rounded-[10px] border border-input bg-card px-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground"
                                autoFocus
                              />
                            </div>
                            <Button size="sm" className="h-11" disabled={featureBusy || !analyzePhone.trim()} type="submit">
                              Analyze
                            </Button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <textarea
                      ref={textareaRef}
                      value={composing}
                      onChange={handleComposeChange}
                      onKeyDown={handleComposeKey}
                      placeholder="Ask about a buyer, a city or a product…"
                      rows={2}
                      aria-label="Message Verafo"
                      role="combobox"
                      aria-expanded={mention != null && mentionRows.length > 0}
                      aria-controls="mention-listbox"
                      aria-autocomplete="list"
                      className="max-h-40 min-h-11 w-full resize-y rounded-[10px] border border-input bg-card px-3 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--teal)]"
                    />

                    {mention && (
                      <div
                        id="mention-listbox"
                        role="listbox"
                        aria-label={mention.kind === 'store' ? 'Matching stores' : 'Matching buyers'}
                        className="absolute bottom-16 start-14 z-40 max-h-64 w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-[16px] border border-border bg-popover p-1 shadow-3"
                      >
                        {mentionRows.length === 0 ? (
                          <p className="px-3 py-2.5 text-[13px] text-muted-foreground">
                            {mention.kind === 'store'
                              ? `No stores match “${mention.query}”`
                              : mention.query.replace(/\D/g, '').length < 6
                                ? 'Type at least 6 digits of a phone number.'
                                : `No buyer matches “${mention.query}”`}
                          </p>
                        ) : (
                          mentionRows.map((r, i) => (
                            <button
                              key={r.key}
                              type="button"
                              role="option"
                              aria-selected={i === mentionIndex}
                              className={cn(
                                'flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-start',
                                i === mentionIndex ? 'bg-muted' : 'hover:bg-muted/60',
                              )}
                              onMouseEnter={() => setMentionIndex(i)}
                              onMouseDown={(e) => {
                                e.preventDefault()
                                pickMention(r.value)
                              }}
                            >
                              <Avatar phone={r.phone} name={r.name} size={26} />
                              <span className={cn('truncate text-[13.5px]', r.phone && 'font-mono')}>{r.label}</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <Button
                    className="size-11 shrink-0 rounded-full"
                    size="icon"
                    variant={busy ? 'outline' : 'default'}
                    disabled={!busy && !canSend}
                    onClick={() => (busy ? stopAnswer() : void send())}
                    aria-label={busy ? 'Stop the answer' : 'Send message'}
                    title={busy ? 'Stop' : 'Send'}
                  >
                    {busy ? <Square className="size-3.5 fill-current" /> : <Send className="size-4" />}
                  </Button>
                </div>

                <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                  <span>{COMPOSER_HINT}</span>
                  {busy && (
                    <span className="inline-flex items-center gap-1 text-primary-text">
                      <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Verafo is answering…
                    </span>
                  )}
                </p>
              </footer>
            </>
          )}
        </section>
      </div>

      {/* Phones: the rail is an overlay drawer rather than a second column. */}
      {!railOpen && (
        <button
          type="button"
          className="fixed end-4 bottom-20 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-teal lg:hidden"
          onClick={() => setRailOpen(true)}
        >
          <MessageSquare className="size-4" /> Chats
        </button>
      )}

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Paste orders</DialogTitle>
            <DialogDescription>
              Paste order lines below — Verafo reads them and checks the buyers before logging anything.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void submitPaste(e)} className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-medium text-foreground">One order per line</span>
              <textarea
                className="min-h-32 w-full resize-y rounded-[10px] border border-input bg-card px-3 py-2 font-mono text-[13px] text-foreground placeholder:text-muted-foreground"
                rows={6}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder={
                  'e.g. 0301 234 5678 | Footwear | PKR 4,500 | Lahore\n0303 999 8888 | Winter jacket | PKR 6,200 | Karachi'
                }
                autoFocus
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11" onClick={() => setPasteOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="h-11" disabled={!pasteText.trim() || busy}>
                Ask Verafo to log these
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
