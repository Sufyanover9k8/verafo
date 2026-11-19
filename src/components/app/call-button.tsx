import { useCallback, useEffect, useState } from 'react'
import { Loader2, Phone } from 'lucide-react'
import { CallError, describeOutcome, LIVE_CALL, readCall, startOrderCall, type Verification } from '@/lib/calls'
import { cn } from '@/lib/utils'
import { useToast } from '@/lib/toast'

/**
 * How long we keep asking Uplift about a call we just placed. A confirmation
 * call usually runs under a minute; two minutes of polling covers the busy
 * cases without pinning a request open forever.
 */
const POLL_MS = 6_000
const MAX_POLLS = 20

type Toast = ReturnType<typeof useToast>

/**
 * Calls in progress, keyed by order id.
 *
 * This lives outside React on purpose. A call takes a minute; the row that
 * started it can re-render (or a card can re-mount) long before the verdict
 * arrives, and a plain component-local `await` would be cancelled with it. By
 * keeping the promise and the active-order set at module scope the call keeps
 * running, the verdict is still toasted, and any row that renders meanwhile
 * knows to show "Calling…".
 */
const inflight = new Map<string, Promise<Verification | null>>()
const listeners = new Set<() => void>()

function announce() {
  listeners.forEach((listener) => listener())
}

/** True while a Verafo call is running for this order. */
export const isCalling = (orderId: string) => inflight.has(orderId)

async function placeAndFollow(
  orderId: string,
  who: string | null | undefined,
  toast: Toast,
): Promise<Verification | null> {
  let verification: Verification
  try {
    const started = await startOrderCall(orderId)
    verification = started.verification
    toast.push({
      kind: 'success',
      title: `Calling ${who?.trim() || 'the buyer'}…`,
      detail: 'Uplift is dialing now. The verdict lands here when the call ends.',
    })
  } catch (error) {
    // A call for this order is already in flight: follow it instead of
    // reporting a failure the merchant cannot act on.
    if (error instanceof CallError && error.status === 409) {
      verification = (await readCall({ orderId })).verification
      toast.push({
        kind: 'info',
        title: 'A call is already running',
        detail: 'Following that one — the verdict lands here when it ends.',
      })
    } else {
      toast.push({
        kind: 'error',
        title: 'Could not place the call',
        detail: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  for (let i = 0; i < MAX_POLLS && LIVE_CALL.includes(verification.status); i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, POLL_MS))
    try {
      verification = (await readCall({ verificationId: verification.id })).verification
    } catch {
      // A dropped poll is not a dropped call — keep asking until the cap.
      continue
    }
  }

  if (LIVE_CALL.includes(verification.status)) {
    toast.push({
      kind: 'info',
      title: 'The call is still going',
      detail: 'Refresh in a minute to see how it ended.',
    })
  } else {
    const { kind, title } = describeOutcome(verification)
    toast.push({ kind, title, detail: verification.summary ?? verification.error ?? undefined })
  }
  return verification
}

/**
 * Place one Uplift call and wait for its verdict.
 *
 * `callingFor` is the order id this component is waiting on, so a list of rows
 * can disable that one row without freezing the page.
 */
export function useCallAction(options: { onSettled?: (verification: Verification) => void } = {}) {
  const toast = useToast()
  const [pending, setPending] = useState<string[]>(() => [...inflight.keys()])

  useEffect(() => {
    const sync = () => setPending([...inflight.keys()])
    listeners.add(sync)
    sync()
    return () => {
      listeners.delete(sync)
    }
  }, [])

  const call = useCallback(
    (orderId: string, who?: string | null) => {
      if (inflight.has(orderId)) return inflight.get(orderId)
      const task = placeAndFollow(orderId, who, toast)
        .then((verification) => {
          if (verification) options.onSettled?.(verification)
          return verification
        })
        .catch(() => null)
        .finally(() => {
          inflight.delete(orderId)
          announce()
        })
      inflight.set(orderId, task)
      announce()
      return task
    },
    [options, toast],
  )

  return { call, pending }
}

interface CallButtonProps {
  orderId: string
  /** Shown in the toast so the merchant knows which buyer is ringing. */
  who?: string | null
  className?: string
  size?: 'sm' | 'md'
  onSettled?: (verification: Verification) => void
}

/**
 * "Call" in the table rows: places a real Uplift call to this order's buyer
 * instead of opening the device dialer.
 */
export function CallButton({ orderId, who, className, size = 'sm', onSettled }: CallButtonProps) {
  const { call, pending } = useCallAction({ onSettled })
  const busy = pending.includes(orderId)
  const btn =
    size === 'sm'
      ? 'inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border bg-card px-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60 md:h-8'
      : 'inline-flex h-11 items-center gap-2 rounded-[10px] border border-border bg-card px-4 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60'

  return (
    <button
      type="button"
      className={cn(btn, className)}
      disabled={busy || pending.length > 0}
      onClick={() => void call(orderId, who)}
      aria-label={busy ? 'Calling the buyer' : 'Call the buyer with Verafo'}
      title="Verafo calls the buyer and records what they say"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Phone className="size-3.5" />}
      {busy ? 'Calling…' : 'Call'}
    </button>
  )
}
