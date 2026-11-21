import { useState } from 'react'
import { Phone, Copy, Check, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/lib/toast'
import { telLink, whatsappLink } from '@/lib/ui'
import { CallButton } from './call-button'
import type { Verification } from '@/lib/calls'

/**
 * The one-tap next step for a risky order: call the buyer, message them on
 * WhatsApp, or copy the number.
 *
 * When the caller passes an `orderId`, "Call" goes through Verafo's own calling
 * stack — Uplift dials the buyer and the verdict comes back here — exactly as
 * it does in the mobile app. Without an `orderId` (a number that is not tied to
 * an order) it falls back to the device dialer, so nothing is lost.
 *
 * WhatsApp and Copy never leave the browser: they open the merchant's own app.
 */
interface RowActionsProps {
  phone: string | null | undefined
  /** Prefilled WhatsApp text, built by the caller from loaded data. */
  message: string
  /** The order behind this row — enables the Uplift call. */
  orderId?: string
  /** Buyer name, for the "Calling Hina…" toast. */
  who?: string | null
  /** Called once a placed call reaches a verdict. */
  onCallSettled?: (verification: Verification) => void
  className?: string
  /** Compact style for table rows. */
  size?: 'sm' | 'md'
}

export function RowActions({
  phone,
  message,
  orderId,
  who,
  onCallSettled,
  className,
  size = 'sm',
}: RowActionsProps) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  const tel = telLink(phone)
  const wa = whatsappLink(phone, message)
  const btn =
    size === 'sm'
      ? 'inline-flex h-11 items-center gap-1.5 rounded-[10px] border border-border bg-card px-2.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted md:h-8'
      : 'inline-flex h-11 items-center gap-2 rounded-[10px] border border-border bg-card px-4 text-[13.5px] font-semibold text-foreground transition-colors hover:bg-muted'

  if (!tel && !wa) return null

  async function copy() {
    try {
      await navigator.clipboard.writeText(String(phone).trim())
      setCopied(true)
      toast.push({ kind: 'success', title: 'Number copied' })
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.push({ kind: 'error', title: 'Could not copy', detail: 'Copy the number by hand.' })
    }
  }

  return (
    <span className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {tel && orderId ? (
        <CallButton orderId={orderId} who={who} size={size} onSettled={onCallSettled} />
      ) : tel ? (
        <a className={btn} href={tel} aria-label={`Call ${phone}`}>
          <Phone className="size-3.5" /> Call
        </a>
      ) : null}
      {wa && (
        <a className={btn} href={wa} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${phone}`}>
          <MessageCircle className="size-3.5" /> WhatsApp
        </a>
      )}
      <button type="button" className={btn} onClick={() => void copy()} aria-label={`Copy ${phone}`}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  )
}
