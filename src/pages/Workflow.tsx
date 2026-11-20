import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/app/page-header'
import { PageShell } from '../components/app/page-shell'
import { NeedsSetup } from '../components/States'
import { money, phone } from '../lib/format'
import { isConfigured, supabase } from '../lib/supabase'
import { useStoreScope } from '../lib/store'
import { useToast } from '../lib/toast'
import {
  DEFAULT_AUTOMATION,
  EDGE_LABEL,
  ORDER_FIELDS,
  latestCall,
  moveOrder,
  readAutomation,
  setAutomation,
  stageOf,
  type Automation,
  type Stage,
  type WorkflowEdge,
  type WorkflowOrder,
} from '../lib/workflow'

/** The six boards, left to right, in the shape the funnel actually has. */
interface BoardSpec {
  stage: Stage
  title: string
  hint: string
}

const COLUMNS: BoardSpec[][] = [
  [{ stage: 'inbox', title: 'Orders', hint: 'No decision yet' }],
  [
    { stage: 'queue', title: 'Call queue', hint: 'Being called, or called and waiting' },
    { stage: 'refused_before', title: 'Refused', hint: 'Refused without a call' },
  ],
  [
    { stage: 'to_deliver', title: 'To deliver', hint: 'Approved, waiting for the courier' },
    { stage: 'refused_after', title: 'Refused', hint: 'Refused on the call' },
  ],
  [
    { stage: 'delivered', title: 'Delivered', hint: 'The courier handed it over' },
    { stage: 'returned', title: 'Declined / returned', hint: 'The courier brought it back' },
  ],
]

/** A wire from one board to another, and the switch that automates it. */
const WIRES: { from: Stage; to: Stage; edge?: WorkflowEdge }[] = [
  { from: 'inbox', to: 'queue', edge: 'call_dial' },
  { from: 'inbox', to: 'refused_before' },
  { from: 'queue', to: 'to_deliver', edge: 'call_ship' },
  { from: 'queue', to: 'refused_after', edge: 'call_refuse' },
  { from: 'to_deliver', to: 'delivered', edge: 'courier_delivered' },
  { from: 'to_deliver', to: 'returned', edge: 'courier_returned' },
]

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function riskTone(score: number | null): string {
  const value = score ?? 0.5
  if (value >= 0.65) return 'bg-risk-high'
  if (value >= 0.35) return 'bg-risk-watch'
  return 'bg-risk-safe'
}

function callLine(order: WorkflowOrder): string | null {
  const call = latestCall(order)
  if (!call) return null
  if (call.status === 'queued' || call.status === 'dialing' || call.status === 'in_call') return 'Calling now'
  if (call.status === 'no_answer') return 'No answer'
  if (call.status === 'failed') return 'Call failed'
  switch (call.outcome) {
    case 'confirmed':
      return 'Confirmed on the call'
    case 'cancelled':
      return 'Cancelled on the call'
    case 'wrong_person':
      return 'Wrong person answered'
    default:
      return 'Called — you decide'
  }
}

export function Workflow() {
  const { store } = useStoreScope()
  const toast = useToast()
  const [orders, setOrders] = useState<WorkflowOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [automation, setAutomationState] = useState<Automation>(DEFAULT_AUTOMATION)
  const [dragging, setDragging] = useState<string | null>(null)
  const [pressed, setPressed] = useState<string | null>(null)
  const [landed, setLanded] = useState<{ id: string; stage: Stage } | null>(null)
  const [over, setOver] = useState<Stage | null>(null)
  const [busy, setBusy] = useState<Stage | null>(null)
  const [boxes, setBoxes] = useState<Partial<Record<Stage, Box>>>({})

  const canvasRef = useRef<HTMLDivElement | null>(null)
  const boards = useRef<Partial<Record<Stage, HTMLElement | null>>>({})

  const load = useCallback(async () => {
    if (!supabase || !store) return
    setLoading(true)
    setFailed(false)
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_FIELDS)
      .eq('store_id', store.id)
      .order('ordered_at', { ascending: false })
      .limit(300)
    if (error) {
      setFailed(true)
      toast.push({ kind: 'error', title: 'Could not load the board', detail: error.message })
    } else {
      setOrders((data ?? []) as unknown as WorkflowOrder[])
    }
    setLoading(false)
  }, [store, toast])

  const loadAutomation = useCallback(async () => {
    if (!store) return
    setAutomationState(await readAutomation(store.id))
  }, [store])

  useEffect(() => {
    void load()
    void loadAutomation()
  }, [load, loadAutomation])

  const groups = useMemo(() => {
    const next: Record<Stage, WorkflowOrder[]> = {
      inbox: [],
      queue: [],
      refused_before: [],
      to_deliver: [],
      refused_after: [],
      delivered: [],
      returned: [],
    }
    for (const order of orders) next[stageOf(order)].push(order)
    return next
  }, [orders])

  // The wires are drawn from measured boards, so they stay attached when the
  // window resizes or a column grows a scrollbar.
  const measure = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const base = canvas.getBoundingClientRect()
    const next: Partial<Record<Stage, Box>> = {}
    for (const [stage, element] of Object.entries(boards.current) as [Stage, HTMLElement | null][]) {
      if (!element) continue
      const rect = element.getBoundingClientRect()
      next[stage] = { x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height }
    }
    setBoxes(next)
  }, [])

  useLayoutEffect(() => {
    measure()
    const observer = new ResizeObserver(() => measure())
    if (canvasRef.current) observer.observe(canvasRef.current)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, orders, loading])

  async function toggle(edge: WorkflowEdge) {
    if (!store) return
    const next = !automation[edge]
    setAutomationState((prev) => ({ ...prev, [edge]: next }))
    try {
      await setAutomation(store.id, edge, next)
    } catch (error) {
      setAutomationState((prev) => ({ ...prev, [edge]: !next }))
      toast.push({
        kind: 'error',
        title: 'Could not change the automation',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function drop(target: Stage, orderId: string) {
    const order = orders.find((entry) => entry.id === orderId)
    setOver(null)
    setDragging(null)
    setPressed(null)
    if (!order || stageOf(order) === target) return
    setBusy(target)
    try {
      await moveOrder(order, target)
      const name = order.order_fulfillment?.customer_name ?? order.buyers?.name ?? phone(order.buyer_phone)
      toast.push({ kind: 'success', title: `Moved ${name}`, detail: 'The board, Orders, Calls and Outcomes all agree now.' })
      await load()
      setLanded({ id: orderId, stage: target })
      window.setTimeout(() => setLanded(null), 700)
    } catch (error) {
      toast.push({
        kind: 'error',
        title: 'Could not move that order',
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  if (!isConfigured) return <NeedsSetup />

  return (
    <PageShell>
      <PageHeader
        title="Workflow"
        description="One board for the whole funnel. Drag a card to move an order; the wires show what Verafo does on its own."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            Refresh
          </button>
        }
      />

      <div ref={canvasRef} className="relative">
        <div className="grid h-[calc(100vh-230px)] min-h-[520px] grid-cols-4 gap-x-14">
          {COLUMNS.map((column, index) => (
            <div
              key={index}
              className={
                column.length > 1 ? 'grid min-h-0 grid-rows-[3fr_1fr] gap-3' : 'grid min-h-0 grid-rows-1'
              }
            >
              {column.map((board) => {
                const items = groups[board.stage]
                const active = over === board.stage
                return (
                  <section
                    key={board.stage}
                    data-stage={board.stage}
                    ref={(element) => {
                      boards.current[board.stage] = element
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      if (over !== board.stage) setOver(board.stage)
                    }}
                    onDragLeave={() => setOver((current) => (current === board.stage ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault()
                      const id = event.dataTransfer.getData('text/plain')
                      if (id) void drop(board.stage, id)
                    }}
                    className={`flex min-h-0 flex-col rounded-xl border bg-card transition-[box-shadow,border-color,background-color,transform] duration-200 ${
                      active
                        ? 'scale-[1.005] border-foreground/30 bg-muted/50 shadow-[0_0_0_3px_hsl(var(--foreground)/0.06)]'
                        : landed?.stage === board.stage
                          ? 'border-foreground/25 shadow-[0_0_0_3px_hsl(var(--foreground)/0.08)]'
                          : 'border-border shadow-[0_1px_2px_rgb(16_24_32/0.05),0_10px_28px_-18px_rgb(16_24_32/0.35)]'
                    }`}
                  >
                    <header className="flex items-baseline justify-between gap-2 rounded-t-xl border-b border-border/60 bg-muted/30 px-3 pb-2 pt-2.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {board.title}
                      </span>
                      <span className="rounded-full bg-background px-1.5 text-[11px] tabular-nums text-muted-foreground">
                        {items.length}
                      </span>
                    </header>
                    <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-2 pt-2">
                      {items.map((order) => {
                        const name =
                          order.order_fulfillment?.customer_name ?? order.buyers?.name ?? phone(order.buyer_phone)
                        const line = board.stage === 'queue' ? callLine(order) : null
                        return (
                          <article
                            key={order.id}
                            data-order-id={order.id}
                            draggable
                            onPointerDown={() => setPressed(order.id)}
                            onPointerUp={() => setPressed((current) => (current === order.id ? null : current))}
                            onPointerCancel={() => setPressed((current) => (current === order.id ? null : current))}
                            onPointerLeave={() => setPressed((current) => (current === order.id ? null : current))}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', order.id)
                              event.dataTransfer.effectAllowed = 'move'
                              setDragging(order.id)
                            }}
                            onDragEnd={() => {
                              setDragging(null)
                              setPressed(null)
                              setOver(null)
                            }}
                            className={`relative cursor-grab rounded-lg border border-border bg-background px-2.5 py-2 transition-[transform,box-shadow,border-color,opacity] duration-200 ease-out [transform-origin:50%_40%] ${
                              dragging === order.id
                                ? 'z-20 rotate-[1.5deg] scale-[1.03] border-foreground/20 shadow-[0_18px_34px_-16px_rgb(16_24_32/0.45)]'
                                : pressed === order.id
                                  ? 'z-10 -rotate-[1deg] scale-[1.02] border-foreground/25 shadow-[0_12px_24px_-14px_rgb(16_24_32/0.4)]'
                                  : 'shadow-[0_1px_2px_rgb(16_24_32/0.06)] hover:-translate-y-px hover:border-foreground/20 hover:shadow-[0_6px_16px_-10px_rgb(16_24_32/0.45)]'
                            } ${landed?.id === order.id ? 'animate-[wf-land_620ms_cubic-bezier(0.2,0.9,0.25,1)]' : ''}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-medium leading-tight text-foreground">
                                  {name}
                                </div>
                                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${riskTone(order.buyers?.risk_score ?? null)}`}
                                  />
                                  <span className="truncate">
                                    {line ?? order.city ?? order.order_reference ?? 'No city'}
                                  </span>
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div
                                  className={`text-[17px] font-semibold leading-none tabular-nums ${
                                    order.buyers?.risk_score == null ? 'text-muted-foreground' : 'text-foreground'
                                  }`}
                                >
                                  {order.buyers?.risk_score == null
                                    ? '—'
                                    : (order.buyers.risk_score ?? 0).toFixed(2)}
                                </div>
                                <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                                  {money(order.price ?? 0)}
                                  {(order.quantity ?? 1) > 1 && ` × ${order.quantity}`}
                                </div>
                              </div>
                            </div>
                          </article>
                        )
                      })}
                      {!items.length && (
                        <p className="px-1 py-3 text-[12px] text-muted-foreground">
                          {loading ? 'Loading…' : failed ? 'Could not load.' : 'Nothing here.'}
                        </p>
                      )}
                    </div>
                    {busy === board.stage && (
                      <span className="px-3 pb-2 text-[11px] text-muted-foreground">Moving…</span>
                    )}
                  </section>
                )
              })}
            </div>
          ))}
        </div>

        {/* The wires live above the boards in their own layer so they can be
            measured and redrawn without touching the layout. */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {WIRES.map((wire) => {
            const from = boxes[wire.from]
            const to = boxes[wire.to]
            if (!from || !to) return null
            const sx = from.x + from.w
            const sy = from.y + from.h / 2
            const tx = to.x
            const ty = to.y + to.h / 2
            const mx = sx + (tx - sx) * 0.5
            const on = wire.edge ? automation[wire.edge] : false
            return (
              <g key={`${wire.from}-${wire.to}`}>
                <path
                  d={`M ${sx} ${sy} H ${mx} V ${ty} H ${tx}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray={wire.edge && !on ? '4 4' : undefined}
                  className="text-border"
                />
                <circle cx={sx} cy={sy} r={2.5} className="fill-border" />
                <circle cx={tx} cy={ty} r={2.5} className="fill-border" />
              </g>
            )
          })}
        </svg>

        {/* Switches sit on the wire they govern, so "who does this" is visible
            without opening a settings page. */}
        <div className="pointer-events-none absolute inset-0">
          {WIRES.filter((wire) => wire.edge).map((wire) => {
            const from = boxes[wire.from]
            const to = boxes[wire.to]
            const edge = wire.edge as WorkflowEdge
            if (!from || !to) return null
            const sx = from.x + from.w
            const tx = to.x
            const mx = sx + (tx - sx) * 0.5
            const x = (mx + tx) / 2
            const y = to.y + to.h / 2
            const on = automation[edge]
            return (
              <button
                key={edge}
                type="button"
                aria-pressed={on}
                aria-label={EDGE_LABEL[edge]}
                title={EDGE_LABEL[edge]}
                onClick={() => void toggle(edge)}
                style={{ left: x, top: y }}
                className={`pointer-events-auto absolute flex h-[18px] w-[32px] -translate-x-1/2 -translate-y-1/2 items-center rounded-full border px-0.5 transition ${
                  on ? 'border-transparent bg-foreground/80' : 'border-border bg-card'
                }`}
              >
                <span
                  className={`h-[12px] w-[12px] rounded-full bg-card transition-transform ${
                    on ? 'translate-x-[13px]' : 'translate-x-0'
                  }`}
                />
              </button>
            )
          })}
        </div>
      </div>
    </PageShell>
  )
}
