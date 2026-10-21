/* ============================================================
   ui/phone.ts — Pakistani phone numbers, and the links built
   from them.

   A number is only trusted when it can be turned into a real
   +92 number. Anything else returns null, so the caller can hide
   the action rather than build a broken link.
   ============================================================ */

export type PhoneKind = 'mobile' | 'landline'

export interface PkPhone {
  /** +923001234567 — what tel: and wa.me both want. */
  e164: string
  /** 0300 1234567 — the local way of writing it. */
  national: string
  /** +92 300 1234567 — how the app writes a number on screen, everywhere. */
  display: string
  kind: PhoneKind
}

/** Digits only, with any leading international prefix kept as 92. */
function toLocalDigits(raw: string): string | null {
  if (typeof raw !== 'string') return null
  let d = raw.replace(/\D/g, '')
  if (!d) return null

  // 0092… / 92… / 0… all mean the same subscriber number.
  if (d.startsWith('0092')) d = d.slice(4)
  else if (d.startsWith('92')) d = d.slice(2)
  else if (d.startsWith('0')) d = d.slice(1)

  return d
}

/**
 * Turn any way a Pakistani number is written into one clean form.
 * Returns null when the number cannot be trusted — a different country,
 * too short, too long, or not a real Pakistani prefix.
 */
export function formatPhonePK(raw: string | null | undefined): PkPhone | null {
  if (!raw) return null

  const cleaned = raw.replace(/[^\d+]/g, '')
  if (!cleaned) return null

  // An explicit international prefix must be Pakistan's, or we refuse it.
  // Without this, "+15551234567" would be read as a 10-digit local number.
  const explicit = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned.startsWith('00') ? cleaned.slice(2) : null
  if (explicit !== null && !/^92\d+$/.test(explicit)) return null

  const d = toLocalDigits(raw)
  if (!d) return null

  // Mobile: 3 + 2 digits (network) + 7 digits = 10 digits after the trunk 0.
  const isMobile = /^3\d{9}$/.test(d)
  // Landline: 2–3 digit area code + 6–8 digit number. Kept, but flagged.
  const isLandline = /^\d{9,11}$/.test(d) && !isMobile

  if (!isMobile && !isLandline) return null

  const national = isMobile
    ? `0${d.slice(0, 3)} ${d.slice(3)}`
    : `0${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`.trim()

  /*
   * The one format the whole app prints: +92 then the mobile's 3-digit
   * network code, then the 7-digit subscriber number. `d` is the national
   * number without its trunk 0, so it is already what follows +92.
   */
  const display = `+92 ${d.slice(0, 3)} ${d.slice(3)}`

  return { e164: `+92${d}`, national, display, kind: isMobile ? 'mobile' : 'landline' }
}

/** tel: link, or null when the number cannot be trusted. */
export function telLink(raw: string | null | undefined): string | null {
  const p = formatPhonePK(raw)
  return p ? `tel:${p.e164}` : null
}

/**
 * wa.me link with a prefilled message, or null when the number cannot
 * be trusted. WhatsApp has no landline, so landlines return null.
 */
export function whatsappLink(raw: string | null | undefined, message: string): string | null {
  const p = formatPhonePK(raw)
  if (!p || p.kind !== 'mobile') return null
  const text = encodeURIComponent(message ?? '')
  return `https://wa.me/${p.e164.replace('+', '')}${text ? `?text=${text}` : ''}`
}

/** The WhatsApp message the dashboard prefills. Store/product/amount only. */
export function confirmOrderMessage(parts: {
  storeName?: string | null
  amount?: number | null
  product?: string | null
}): string {
  const store = (parts.storeName ?? '').trim() || 'Verafo'
  const product = (parts.product ?? '').trim() || 'your order'
  const amount =
    parts.amount == null || Number.isNaN(Number(parts.amount))
      ? null
      : Math.round(Number(parts.amount)).toLocaleString('en-PK')
  const money = amount ? ` of ${amount} PKR` : ''
  return `Hello, this is ${store}. Please confirm your order for ${product}${money}. Reply YES to confirm.`
    .replace(/\s+/g, ' ')
    .trim()
}
