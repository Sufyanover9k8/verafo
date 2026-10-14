import { useState } from 'react'
import { Phone, Copy, Check, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/lib/toast'
import { telLink, whatsappLink } from '@/lib/ui'

/**
 * The one-tap next step for a risky order: call the buyer, message them on
 * WhatsApp, or copy the number.
 *
 * Buttons only appear when the phone number can actually be turned into a
 * working link — a landline gets Call and Copy, never WhatsApp. Nothing is
 * sent by Verafo: every button opens the merchant's own phone or WhatsApp.
 */
interface RowActionsProps {
  phone: string | null | undefined
  /** Prefilled WhatsApp text, built by the caller from loaded data. */
  message: string
  className?: string
  /** Compact style for table rows. */
  size?: 'sm' | 'md'
}

export function RowActions({ phone, message, className, size = 'sm' }: RowActionsProps) {
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
      {tel && (
        <a className={btn} href={tel} aria-label={`Call ${phone}`}>
          <Phone className="size-3.5" /> Call
        </a>
      )}
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
