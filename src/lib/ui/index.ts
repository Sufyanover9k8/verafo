/* ============================================================
   ui/index.ts — the small display helpers, in one place.
   Re-exports timeAgo so callers can import from lib/ui.
   ============================================================ */

export { formatPKR, formatCount, sentence } from './money'
export { formatPhonePK, telLink, whatsappLink, confirmOrderMessage, type PkPhone, type PhoneKind } from './phone'
export { toCsv, escapeCsvCell, type CsvRow } from './csv'
export { timeAgo, money } from '../format'
export { readPref, writePref, readJsonPref, writeJsonPref } from './prefs'
