/* ============================================================
   ui/csv.ts — CSV that survives Excel and Google Sheets.
   · wraps values in quotes and doubles inner quotes
   · leads with a UTF-8 BOM so PKR and Urdu names open correctly
   · defuses formula injection: a cell starting with = + - @ (or a
     tab / carriage return) gets a leading apostrophe, so a buyer
     name can never run as a spreadsheet formula
   ============================================================ */

/** Dangerous first characters for spreadsheet formula injection. */
const FORMULA_START = /^[=+\-@\t\r]/

/** Quote and escape one cell. */
export function escapeCsvCell(value: unknown): string {
  if (value == null) return '""'
  let s = String(value)

  if (FORMULA_START.test(s)) s = `'${s}`

  // Quote whenever the value contains a quote, comma, or newline.
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  else s = `"${s}"`

  return s
}

export type CsvRow = Record<string, unknown>

/**
 * Build a CSV string. `columns` fixes the order so two exports of the
 * same report always line up.
 */
export function toCsv(rows: CsvRow[], columns?: string[]): string {
  const cols = columns && columns.length > 0 ? columns : rows.length > 0 ? Object.keys(rows[0]) : []
  if (cols.length === 0) return ''

  const header = cols.map(escapeCsvCell).join(',')
  if (rows.length === 0) return `\uFEFF${header}\r\n`

  const body = rows.map((r) => cols.map((c) => escapeCsvCell(r[c])).join(',')).join('\r\n')
  return `\uFEFF${header}\r\n${body}\r\n`
}
