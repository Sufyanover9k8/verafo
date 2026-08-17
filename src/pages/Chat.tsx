import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { ChartCard } from '../components/ChartCard'
import { FileCard } from '../components/FileCard'
import { Icon } from '../components/Icon'
import { EmptyState, NeedsSetup } from '../components/States'
import { timeAgo } from '../lib/format'
import { activeMention, mentionPhones, renderMentions } from '../lib/mentions'
import { functionsBaseUrl, isConfigured, supabase } from '../lib/supabase'
import { useToast } from '../lib/toast'
import type { AnalyzeReport, ChatMessage, ChatRow, ChartSpec, FileSpec } from '../lib/types'

const CHART_MARKER_RE = /\[\[CHART\]\]([\s\S]*?)\[\[\/CHART\]\]/g
const FILE_MARKER_RE = /\[\[FILE\]\]([\s\S]*?)\[\[\/FILE\]\]/g

function parseCharts(content: string): { text: string; charts: ChartSpec[] } {
  const charts: ChartSpec[] = []
  let lastIndex = 0
  for (const m of content.matchAll(CHART_MARKER_RE)) {
    try {
      charts.push(JSON.parse(m[1]) as ChartSpec)
    } catch {
      // skip malformed markers
    }
    lastIndex = (m.index ?? 0) + m[0].length
  }
  const text =
    lastIndex > 0
      ? content.slice(0, lastIndex).replace(CHART_MARKER_RE, '').trim()
      : content.trim()
  return { text, charts }
}

function parseFiles(content: string): { text: string; files: FileSpec[] } {
  const files: FileSpec[] = []
  let lastIndex = 0
  for (const m of content.matchAll(FILE_MARKER_RE)) {
    try {
      files.push(JSON.parse(m[1]) as FileSpec)
    } catch {
      // skip malformed markers
    }
    lastIndex = (m.index ?? 0) + m[0].length
  }
  const text =
    lastIndex > 0
      ? content.slice(0, lastIndex).replace(FILE_MARKER_RE, '').trim()
      : content.trim()
  return { text, files }
}

const FALLBACK_SUGGESTIONS = [
  'Should I ship an order to a buyer in my network?',
  'Show me the top 10 people who buy footwear',
  'Pie chart of my orders by store',
  'Which buyers are the biggest refusal risk?',
]

const REPORT_RE = /^\[(Analyze|Trends|Suggestions)\]/

function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*/g, '')
}

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
  riskiest: { phone: string; risk_score: number; total_orders: number }[]
  weeklyTrend: { label: string; total: number; accepted: number; refused: number }[]
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
    lines.push(`- ${b.phone}: risk ${b.risk_score.toFixed(2)}, ${b.total_orders} orders`)
  }
  return lines.join('\n')
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="chat-bubble user">
        <span className="chat-name">You</span>
        <p>{renderMentions(msg.content)}</p>
      </div>
    )
  }

  const kind = msg.content.startsWith('[Analyze]')
    ? 'analyze'
    : msg.content.startsWith('[Trends]')
      ? 'trends'
      : msg.content.startsWith('[Suggestions]')
        ? 'suggest'
        : 'chat'
  const label =
    kind === 'analyze'
      ? 'Buyer analysis'
      : kind === 'trends'
        ? 'Network trends'
        : kind === 'suggest'
          ? 'Suggestions'
          : 'Verafo'
  const icon =
    kind === 'analyze' ? 'stats-chart-outline' : kind === 'trends' ? 'trending-up-outline' : 'sparkles-outline'
  const { text: chartText, charts } = parseCharts(msg.content)
  const { text, files } = parseFiles(chartText)
  const lines = text.split('\n').filter((l) => l && !REPORT_RE.test(l))

  return (
    <div className={`chat-bubble ai${kind !== 'chat' ? ` report ${kind}` : ''}`}>
      <span className="chat-name">
        <Icon name={icon} size={13} /> {label}
      </span>
      <div className="msg-body">
        {lines.map((line, i) => {
          if (line.startsWith('- ')) {
            return (
              <div key={i} className="msg-bullet">
                {renderMentions(plain(line.slice(2)))}
              </div>
            )
          }
          if (/^(Verdict|Recommendation|Confidence):/.test(line)) {
            const idx = line.indexOf(': ')
            return (
              <p key={i} className="msg-fact">
                <strong>{line.slice(0, idx)}:</strong>
                {plain(line.slice(idx + 1))}
              </p>
            )
          }
          return <p key={i}>{renderMentions(plain(line))}</p>
        })}
        {charts.map((c, i) => (
          <ChartCard key={i} spec={c} />
        ))}
        {files.map((f, i) => (
          <FileCard key={i} spec={f} />
        ))}
      </div>
    </div>
  )
}

export function Chat() {
  const toast = useToast()
  const [chats, setChats] = useState<ChatRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [composing, setComposing] = useState('')
  const [busy, setBusy] = useState(false)
  const [featureBusy, setFeatureBusy] = useState(false)
  const [working, setWorking] = useState<WorkingState | null>(null)
  const [streamText, setStreamText] = useState('')
  const [liveFiles, setLiveFiles] = useState<FileSpec[]>([])
  const [mention, setMention] = useState<{ at: number; query: string } | null>(null)
  const [mentionResults, setMentionResults] = useState<{ phone: string }[]>([])
  const [suggestions, setSuggestions] = useState<string[]>(FALLBACK_SUGGESTIONS)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [analyzeOpen, setAnalyzeOpen] = useState(false)
  const [analyzePhone, setAnalyzePhone] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [railOpen, setRailOpen] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const mentionId = useRef(0)
  const toolStepId = useRef(0)

  const activeChat = chats.find((c) => c.id === activeId) ?? null

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

  const loadMessages = useCallback(
    async (chatId: string) => {
      if (!supabase) return
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })
      if (error) throw error
      setMessages(data ?? [])
    },
    [],
  )

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
    if (!activeId || messages.length > 0) return
    let cancelled = false
    const base = functionsBaseUrl()
    if (!base) return
    fetch(`${base}/verafo-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'suggest' }),
    })
      .then((r) => r.json())
      .then((j: { suggestions?: string[] }) => {
        if (!cancelled && Array.isArray(j.suggestions) && j.suggestions.length > 0) {
          setSuggestions(j.suggestions)
        }
      })
      .catch(() => {
        if (!cancelled) setSuggestions(FALLBACK_SUGGESTIONS)
      })
    return () => {
      cancelled = true
    }
  }, [activeId, messages.length])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight })
  }, [messages, activeId, loading, working, streamText])

  const fetchMentions = useCallback(async (query: string) => {
    if (!supabase) return
    const id = ++mentionId.current
    const { data, error } = await supabase
      .from('buyers')
      .select('phone')
      .ilike('phone', `%${query.replace(/[^\d+]/g, '')}%`)
      .limit(8)
    if (error || id !== mentionId.current) return
    setMentionResults((data ?? []) as { phone: string }[])
  }, [])

  useEffect(() => {
    if (mention) void fetchMentions(mention.query)
    else setMentionResults([])
  }, [mention, fetchMentions])

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
  }

  function pickMention(phone: string) {
    if (!mention) return
    const next =
      composing.slice(0, mention.at) + `@${phone} ` + composing.slice(mention.at + 1 + mention.query.length)
    setComposing(next)
    setMention(null)
    window.setTimeout(() => textareaRef.current?.focus(), 0)
  }

  function handleComposeKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    } else if (e.key === 'Escape') {
      setMention(null)
    }
  }

  function handleSseEvent(raw: string) {
    let event = 'message'
    const dataLines: string[] = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length === 0) return
    let data: Record<string, unknown>
    try {
      data = JSON.parse(dataLines.join('\n'))
    } catch {
      return
    }
    switch (event) {
      case 'phase': {
        const phase = String(data.phase ?? 'thinking')
        setWorking((w) => ({
          phase: (['understanding', 'researching', 'writing'].includes(phase) ? phase : 'thinking') as WorkingState['phase'],
          label: String(data.label ?? 'Working…'),
          tools: w?.tools ?? [],
        }))
        break
      }
      case 'tool_call': {
        const id = ++toolStepId.current
        setWorking((w) => ({
          phase: w?.phase ?? 'researching',
          label: w?.label ?? 'Researching your data…',
          tools: [
            ...(w?.tools ?? []),
            {
              id,
              name: String(data.name ?? 'tool'),
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
      case 'error': {
        throw new Error(String(data.message ?? 'Verafo hit an error'))
      }
    }
  }

  const send = useCallback(async () => {
    const raw = composing.trim()
    if (!supabase || !activeId || !raw || busy) return
    const phones = mentionPhones(raw)
    const phone = phones[0] ?? activeChat?.phone ?? null
    setBusy(true)
    setComposing('')
    setMention(null)
    setStreamText('')
    setLiveFiles([])
    setWorking({ phase: 'thinking', label: 'Thinking…', tools: [] })
    setMessages((m) => [
      ...m,
      {
        id: `tmp-${Date.now()}`,
        chat_id: activeId,
        role: 'user',
        content: raw,
        phone,
        created_at: new Date().toISOString(),
      },
    ])
    try {
      const { error: insErr } = await supabase
        .from('chat_messages')
        .insert({ chat_id: activeId, role: 'user', content: raw, phone })
      if (insErr) throw insErr
      if (phone && !activeChat?.phone) {
        await supabase.from('chats').update({ phone }).eq('id', activeId)
      }
      const base = functionsBaseUrl()
      if (!base) throw new Error('Edge functions are not configured')
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'chat', chat_id: activeId, prompt: raw, phone: phone ?? undefined }),
      })
      if (!res.ok || !res.body) {
        let detail = 'Request failed'
        try {
          const j = (await res.json()) as { error?: string }
          if (j.error) detail = j.error
        } catch {
          /* not json */
        }
        throw new Error(detail)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let done = false
      while (!done) {
        const { value, done: streamDone } = await reader.read()
        done = streamDone
        buf += decoder.decode(value ?? new Uint8Array(), { stream: !done })
        let sep: number
        while ((sep = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, sep)
          buf = buf.slice(sep + 2)
          if (raw.trim()) handleSseEvent(raw)
        }
      }
      if (buf.trim()) handleSseEvent(buf)
      await Promise.all([loadMessages(activeId), loadChats()])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({
        kind: 'error',
        title: 'Verafo chat failed',
        detail: `${message} - is the verafo-ai edge function deployed with an OpenAI key?`,
      })
      try {
        await loadMessages(activeId)
      } catch {
        /* keep the optimistic bubble */
      }
    } finally {
      setBusy(false)
      setWorking(null)
      setStreamText('')
      setLiveFiles([])
    }
  }, [composing, busy, activeId, activeChat, toast, loadMessages, loadChats])

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
    const base = functionsBaseUrl()
    if (!base) return
    setFeatureBusy(true)
    try {
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'analyze', phone }),
      })
      const json = (await res.json()) as { report?: AnalyzeReport; error?: string }
      if (!res.ok || !json.report) throw new Error(json.error ?? 'Analysis failed')
      await appendAssistant(formatAnalyze(phone, json.report))
      setAnalyzeOpen(false)
      setAnalyzePhone('')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({ kind: 'error', title: 'Analysis failed', detail: message })
    } finally {
      setFeatureBusy(false)
    }
  }

  async function runTrends() {
    if (!supabase || !activeId || featureBusy) return
    const base = functionsBaseUrl()
    if (!base) return
    setFeatureBusy(true)
    try {
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trends' }),
      })
      const json = (await res.json()) as { error?: string; totals?: unknown }
      if (!res.ok || !json.totals) throw new Error(json.error ?? 'Trends failed')
      await appendAssistant(formatTrends(json as unknown as TrendsReport))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({ kind: 'error', title: 'Trends failed', detail: message })
    } finally {
      setFeatureBusy(false)
    }
  }

  async function runSuggest() {
    if (!supabase || !activeId || featureBusy) return
    const base = functionsBaseUrl()
    if (!base) return
    setFeatureBusy(true)
    try {
      const res = await fetch(`${base}/verafo-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'suggest' }),
      })
      const json = (await res.json()) as { error?: string; suggestions?: string[] }
      if (!res.ok || !Array.isArray(json.suggestions)) throw new Error(json.error ?? 'Suggestions failed')
      await appendAssistant(['[Suggestions] Things to try', ...json.suggestions.map((s) => `- ${s}`)].join('\n'))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.push({ kind: 'error', title: 'Suggestions failed', detail: message })
    } finally {
      setFeatureBusy(false)
    }
  }

  if (!isConfigured) return <NeedsSetup />

  return (
    <div className={`chat-page${railOpen ? '' : ' rail-closed'}`}>
      <aside className="card chat-rail">
        <div className="chat-rail-head">
          <div>
            <h2>
              <Icon name="chatbubbles-outline" size={17} /> Ask Verafo
            </h2>
            <p>COD risk assistant</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => void newChat()}>
            <Icon name="add" size={15} /> New
          </button>
        </div>

        <div className="chat-items">
          {chats.length === 0 && (
            <div className="chat-items-empty">
              <EmptyState
                icon="chatbubble-outline"
                title="No chats yet"
                detail="Start a conversation to get going."
              />
            </div>
          )}
          {chats.map((c) => (
            <button
              key={c.id}
              className={`chat-item${activeId === c.id ? ' active' : ''}`}
              onClick={() => {
                setRenaming(false)
                setAnalyzeOpen(false)
                setActiveId(c.id)
              }}
            >
              <div className="chat-item-line">
                <span className="chat-item-title">{c.title}</span>
                <span className="chat-item-time">{timeAgo(c.last_message_at ?? c.created_at)}</span>
              </div>
              <span className="chat-item-snippet">
                {c.last_message ?? <span className="muted">No messages yet</span>}
              </span>
              {c.phone && (
                <span className="chat-item-phone">
                  <Icon name="at-outline" size={11} /> {c.phone}
                </span>
              )}
            </button>
          ))}
        </div>
      </aside>

      <section className="card chat-window spotlight">
        {!activeChat ? (
          <div className="chat-window-empty">
            <EmptyState
              icon="chatbubbles-outline"
              title="No chat selected"
              detail="Pick a conversation from the list, or start a new one."
            />
            <button className="btn btn-primary" onClick={() => void newChat()}>
              <Icon name="add" size={16} /> New chat
            </button>
          </div>
        ) : (
          <>
            <header className="chat-head">
              <div className="chat-head-main">
                {renaming ? (
                  <input
                    className="title-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void saveRename()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveRename()
                      else if (e.key === 'Escape') setRenaming(false)
                    }}
                    autoFocus
                  />
                ) : (
                  <h3 title="Double-click to rename" onDoubleClick={startRename}>
                    {activeChat.title}
                  </h3>
                )}
                <span className="chat-head-meta">
                  {activeChat.phone && (
                    <span className="pinned-badge">
                      <Icon name="at-outline" size={12} /> {activeChat.phone}
                    </span>
                  )}
                  <span>
                    {messages.length} message{messages.length === 1 ? '' : 's'}
                  </span>
                </span>
              </div>
              <div className="chat-head-actions">
                <button
                  className="icon-btn"
                  title={railOpen ? 'Hide history' : 'Show history'}
                  onClick={() => setRailOpen((v) => !v)}
                >
                  <Icon name="chatbubbles-outline" size={15} />
                </button>
                <button className="icon-btn" title="Rename" onClick={startRename}>
                  <Icon name="pencil-outline" size={15} />
                </button>
                <button className="icon-btn danger" title="Delete chat" onClick={() => void deleteChat(activeChat.id)}>
                  <Icon name="trash-outline" size={15} />
                </button>
              </div>
            </header>

            <div ref={listRef} className="chat-msgs">
              {loading && (
                <div className="chat-loading">
                  <Icon name="refresh-outline" size={18} className="spin" /> Loading messages…
                </div>
              )}
              {!loading && messages.length === 0 && (
                <div className="chat-start-hint">
                  <EmptyState
                    icon="sparkles-outline"
                    title="Say hello to Verafo"
                    detail="Ask about a buyer with @, or use the tools below for instant reports."
                  />
                </div>
              )}
              {messages.map((m) => (
                <MessageBubble key={m.id} msg={m} />
              ))}
              {working && (
                <div className="chat-bubble ai working-bubble">
                  <span className="chat-name">
                    <Icon name="sparkles-outline" size={13} /> Verafo
                  </span>
                  <div className="working-body">
                    <div className="working-phase">
                      <span className="working-spinner">
                        <Icon name="ellipsis-horizontal" size={16} className="working-dots" />
                      </span>
                      <span>{working.label}</span>
                    </div>
                    {working.tools.length > 0 && (
                      <div className="working-tools">
                        {working.tools.map((t) => (
                          <div key={t.id} className={`working-tool${t.status === 'error' ? ' error' : ''}`}>
                            <span className={`working-tool-status ${t.status}`}>
                              {t.status === 'running' ? (
                                <Icon name="refresh-outline" size={13} className="spin" />
                              ) : t.status === 'done' ? (
                                <Icon name="checkmark" size={13} />
                              ) : (
                                <Icon name="close" size={13} />
                              )}
                            </span>
                            <span className="working-tool-label">
                              {t.label}
                              {t.args && <span className="working-tool-args"> ({t.args})</span>}
                            </span>
                            {t.summary && <span className="working-tool-summary">{t.summary}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {liveFiles.map((f, i) => (
                      <FileCard key={`live-${i}`} spec={f} />
                    ))}
                    {streamText && (
                      <div className="working-text">
                        {streamText}
                        <span className="working-caret" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <footer className="chat-composer">
              {messages.length === 0 && (
                <div className="suggest-row">
                  <span className="suggest-label">
                    <Icon name="sparkles-outline" size={13} /> Try asking
                  </span>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      className="chip"
                      disabled={busy}
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

              <div className="composer-row">
                <button
                  className={`tools-btn${toolsOpen ? ' active' : ''}`}
                  title="Tools"
                  onClick={() => {
                    setToolsOpen((v) => !v)
                    setMention(null)
                  }}
                >
                  <Icon name="add" size={18} />
                </button>
                <div className="composer-input-wrap">
                  <textarea
                    ref={textareaRef}
                    value={composing}
                    onChange={handleComposeChange}
                    onKeyDown={handleComposeKey}
                    placeholder="Ask Verafo - type @ to mention a buyer"
                    rows={2}
                  />
                  {mention && (
                    <div className="mention-pop">
                      {mentionResults.length === 0 ? (
                        <div className="mention-empty">No buyers match "{mention.query}"</div>
                      ) : (
                        mentionResults.map((b) => (
                          <button
                            key={b.phone}
                            className="mention-row"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              pickMention(b.phone)
                            }}
                          >
                            <Icon name="person-outline" size={15} className="recent-icon" />
                            <span className="mention-phone">{b.phone}</span>
                            <Icon name="at-outline" size={13} className="mention-at" />
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <button
                  className="btn btn-primary composer-send"
                  disabled={busy || !composing.trim()}
                  onClick={() => void send()}
                  title="Send"
                >
                  {busy ? (
                    <Icon name="refresh-outline" size={18} className="spin" />
                  ) : (
                    <Icon name="send" size={17} />
                  )}
                </button>
                {toolsOpen && (
                  <div className="tools-pop">
                    <button
                      className="tools-pop-item"
                      onClick={() => {
                        setAnalyzeOpen((v) => !v)
                      }}
                    >
                      <Icon name="stats-chart-outline" size={15} /> Analyze buyer
                    </button>
                    <button
                      className="tools-pop-item"
                      disabled={featureBusy}
                      onClick={() => {
                        setToolsOpen(false)
                        void runTrends()
                      }}
                    >
                      <Icon name="trending-up-outline" size={15} /> Network trends
                    </button>
                    <button
                      className="tools-pop-item"
                      disabled={featureBusy}
                      onClick={() => {
                        setToolsOpen(false)
                        void runSuggest()
                      }}
                    >
                      <Icon name="sparkles-outline" size={15} /> Suggestions
                    </button>
                    {analyzeOpen && (
                      <form className="analyze-form" onSubmit={(e) => void runAnalyze(e)}>
                        <input
                          type="tel"
                          inputMode="tel"
                          value={analyzePhone}
                          onChange={(e) => setAnalyzePhone(e.target.value)}
                          placeholder="+92 3xx xxxxxxx"
                          autoFocus
                        />
                        <button className="btn btn-primary btn-sm" disabled={featureBusy || !analyzePhone.trim()}>
                          Analyze
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </footer>
          </>
        )}
      </section>

      {!railOpen && (
        <button className="rail-tab" onClick={() => setRailOpen(true)} title="Show chat history">
          <Icon name="chatbubbles-outline" size={16} />
        </button>
      )}
    </div>
  )
}
