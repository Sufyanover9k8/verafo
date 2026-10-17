import { useState, type ReactNode } from 'react'
import { BarChart3, Check, Copy, Sparkles, TrendingUp } from 'lucide-react'
import { ChartCard } from '@/components/ChartCard'
import { FileCard } from '@/components/FileCard'
import { cn } from '@/lib/utils'
import { renderMentions } from '@/lib/mentions'
import type { ChatMessage, ChartSpec, FileSpec } from '@/lib/types'

/* ────────────────────────────────────────────────────────────
   The assistant answers in in-band markers, not Markdown. These
   three parsers are the only place that format is understood, and
   they are also what "copy" and "export" use to get plain text.
   ──────────────────────────────────────────────────────────── */

const CHART_MARKER_RE = /\[\[CHART\]\]([\s\S]*?)\[\[\/CHART\]\]/g
const FILE_MARKER_RE = /\[\[FILE\]\]([\s\S]*?)\[\[\/FILE\]\]/g
const CITES_MARKER_RE = /\[\[CITES\]\]([\s\S]*?)\[\[\/CITES\]\]/g

/** Tool name → the plain-English phrase the citation line shows. */
const TOOL_LABELS: Record<string, string> = {
  search_orders: 'searched orders',
  buyers_by_city: 'buyers by city',
  top_buyers: 'top buyers',
  buyer_profile: 'buyer profile',
  city_overview: 'city overview',
  category_overview: 'category overview',
  store_overview: 'store overview',
  top_products: 'top products',
  network_overview: 'network overview',
  refusal_reasons: 'refusal reasons',
  buyer_orders: 'order history',
  weekly_trend: 'weekly trend',
  similar_buyers: 'similar buyers',
  buyer_verdict: 'buyer verdict',
  search_buyers: 'search buyers',
  create_file: 'generated a file',
}

function parseCharts(content: string): { text: string; charts: ChartSpec[] } {
  const charts: ChartSpec[] = []
  const text = content.replace(CHART_MARKER_RE, (_m, inner) => {
    try {
      charts.push(JSON.parse(String(inner)) as ChartSpec)
    } catch {
      // skip malformed markers
    }
    return ''
  })
  return { text: text.trim(), charts }
}

function parseFiles(content: string): { text: string; files: FileSpec[] } {
  const files: FileSpec[] = []
  const text = content.replace(FILE_MARKER_RE, (_m, inner) => {
    try {
      files.push(JSON.parse(String(inner)) as FileSpec)
    } catch {
      // skip malformed markers
    }
    return ''
  })
  return { text: text.trim(), files }
}

function parseCites(content: string): { text: string; cites: string[] } {
  const cites: string[] = []
  const text = content.replace(CITES_MARKER_RE, (_m, inner) => {
    for (const t of String(inner ?? '').split('|')) if (t.trim()) cites.push(t.trim())
    return ''
  })
  return { text: text.trim(), cites }
}

/**
 * Read every marker out of one assistant message in a single pass.
 *
 * The three parsers above are order-agnostic on their own, which matters:
 * chaining them used to lose a file marker that arrived after a chart marker,
 * because the first parser trimmed everything from the last chart onwards.
 */
export function parseAnswer(content: string): { text: string; charts: ChartSpec[]; files: FileSpec[]; cites: string[] } {
  const { text: withoutCites, cites } = parseCites(content)
  const { text: withoutCharts, charts } = parseCharts(withoutCites)
  const { text, files } = parseFiles(withoutCharts)
  return { text, charts, files, cites }
}

/**
 * Everything the assistant said, with its markers and emphasis stripped.
 * Exported because the chat export and copy actions need the same plain text.
 */
export function plainText(content: string): string {
  return parseAnswer(content)
    .text.replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*/g, '')
    .trim()
}

function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*/g, '')
}

/* ────────────────────────────────────────────────────────────
   One message
   ──────────────────────────────────────────────────────────── */

type ReportKind = 'analyze' | 'trends' | 'suggest' | 'chat'

const REPORT: Record<ReportKind, { label: string; icon: typeof Sparkles }> = {
  analyze: { label: 'Buyer analysis', icon: BarChart3 },
  trends: { label: 'Network trends', icon: TrendingUp },
  suggest: { label: 'Suggestions', icon: Sparkles },
  chat: { label: 'Verafo', icon: Sparkles },
}

function reportKind(content: string): ReportKind {
  if (content.startsWith('[Analyze]')) return 'analyze'
  if (content.startsWith('[Trends]')) return 'trends'
  if (content.startsWith('[Suggestions]')) return 'suggest'
  return 'chat'
}

const FACT_RE = /^(Verdict|Recommendation|Confidence):/
const REPORT_LINE_RE = /^\[(Analyze|Trends|Suggestions)\]/

/**
 * Inline text with **bold** honoured.
 *
 * The model writes markdown emphasis ("**Week 35**: 67 orders…") and this view
 * rendered it literally, so merchants read the asterisks. Only bold is
 * supported — that is all the answers use, and anything richer belongs in a
 * markdown renderer rather than a regex.
 */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-foreground">
            {renderMentions(plain(part.slice(2, -2)))}
          </strong>
        ) : (
          <span key={i}>{renderMentions(plain(part))}</span>
        ),
      )}
    </>
  )
}

/** Bullets become one list; "Verdict: …" lines become labelled facts. */
function AnswerBody({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim() && !REPORT_LINE_RE.test(l))
  const blocks: ReactNode[] = []
  let bullets: string[] = []

  const flush = () => {
    if (bullets.length === 0) return
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="m-0 flex list-none flex-col gap-1.5 p-0">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-foreground">
            <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0"><RichText text={b} /></span>
          </li>
        ))}
      </ul>,
    )
    bullets = []
  }

  for (const line of lines) {
    if (line.startsWith('- ')) {
      bullets.push(line.slice(2))
      continue
    }
    flush()
    if (FACT_RE.test(line)) {
      const idx = line.indexOf(': ')
      blocks.push(
        <p key={`f-${blocks.length}`} className="m-0 text-[14px] leading-relaxed">
          <strong className="font-semibold text-foreground">{line.slice(0, idx)}:</strong>
          <span className="text-muted-foreground"><RichText text={line.slice(idx + 1)} /></span>
        </p>,
      )
    } else {
      blocks.push(
        <p key={`p-${blocks.length}`} className="m-0 text-[14px] leading-relaxed text-foreground">
          <RichText text={line} />
        </p>,
      )
    }
  }
  flush()

  return <div className="flex flex-col gap-2.5">{blocks}</div>
}

/** Copy-to-clipboard for one message, including its plain-text form. */
function CopyButton({ content, label, className }: { content: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard
          .writeText(plainText(content))
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1600)
          })
          .catch(() => {
            /* clipboard unavailable */
          })
      }}
      className={cn(
        'inline-grid size-8 shrink-0 place-items-center rounded-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  )
}

export function ChatMessageBubble({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div className="group flex max-w-[min(46rem,88%)] flex-col items-end gap-1 self-end">
        <span className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">You</span>
        <div className="flex items-start gap-1.5">
          <CopyButton
            content={msg.content}
            label="Copy message"
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          />
          {/* The brand fill, with ink text: white on this teal does not pass. */}
          <p className="m-0 rounded-[16px] rounded-ee-[4px] bg-risk-safe-soft px-4 py-2.5 text-[14px] leading-relaxed break-words text-foreground ring-1 ring-risk-safe/30">
            {renderMentions(msg.content, true)}
          </p>
        </div>
      </div>
    )
  }

  const kind = reportKind(msg.content)
  const { label, icon: Icon } = REPORT[kind]
  const { text, charts, files, cites } = parseAnswer(msg.content)

  return (
    <div className="group flex max-w-[min(52rem,94%)] flex-col gap-1 self-start">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-primary-text uppercase">
          <Icon className="size-3.5" aria-hidden="true" /> {label}
        </span>
        <CopyButton
          content={msg.content}
          label="Copy answer"
          className="size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        />
      </div>

      <div className="flex flex-col gap-3 rounded-[16px] rounded-es-[4px] border border-s-[3px] border-border bg-card px-4 py-3.5">
        <AnswerBody text={text} />

        {charts.length > 0 && (
          <div className="flex flex-col gap-3">
            {charts.map((c, i) => (
              <ChartCard key={i} spec={c} />
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="flex flex-col gap-3">
            {files.map((f, i) => (
              <FileCard key={i} spec={f} />
            ))}
          </div>
        )}

        {cites.length > 0 && (
          <p className="m-0 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5 text-[11.5px] text-muted-foreground">
            Based on
            {cites.map((c, i) => (
              <span key={`${c}-${i}`} className="rounded-full border border-border bg-muted px-2 py-0.5 font-medium">
                {TOOL_LABELS[c] ?? c}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  )
}
