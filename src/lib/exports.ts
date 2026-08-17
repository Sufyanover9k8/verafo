import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import type { FileSpec } from './types'

const ACCENT: [number, number, number] = [106, 76, 187]
const MUTED: [number, number, number] = [110, 118, 138]
const PALETTE: [number, number, number][] = [
  [106, 76, 187],
  [139, 92, 246],
  [16, 185, 129],
  [245, 158, 11],
  [244, 63, 94],
  [56, 189, 248],
]

function cellRaw(_col: FileSpec['columns'][number], value: string | number | undefined): string | number {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  return String(value)
}

function cellLabel(col: FileSpec['columns'][number], value: string | number | undefined): string {
  const raw = cellRaw(col, value)
  if (col.format === 'pkr') return `${Number(raw).toLocaleString('en-PK')} PKR`
  if (col.format === 'percent') return `${Math.round(Number(raw))}%`
  if (col.format === 'number') return Number(raw).toLocaleString('en-PK')
  return String(raw)
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'verafo-report'
  )
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function filenameFor(spec: FileSpec, ext: string): string {
  return `${slugify(spec.title)}.${ext}`
}

function toRows(spec: FileSpec): string[][] {
  return spec.rows.map((r) => spec.columns.map((c) => String(cellRaw(c, r[c.key]))))
}

export function downloadCsv(spec: FileSpec) {
  const head = spec.columns.map((c) => {
    const v = c.label.replace(/"/g, '""')
    return /[",\n]/.test(v) ? `"${v}"` : v
  })
  const body = toRows(spec).map((row) =>
    row.map((v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(','),
  )
  const csv = '\uFEFF' + [head.join(','), ...body].join('\r\n')
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filenameFor(spec, 'csv'))
}

export function downloadExcel(spec: FileSpec) {
  const aoa: (string | number)[][] = [
    spec.columns.map((c) => c.label),
    ...spec.rows.map((r) => spec.columns.map((c) => cellRaw(c, r[c.key]))),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = spec.columns.map((c) => ({ wch: Math.min(32, Math.max(12, c.label.length + 6)) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Verafo')
  XLSX.writeFile(wb, filenameFor(spec, 'xlsx'))
}

function drawPdfChart(doc: jsPDF, spec: FileSpec, x: number, y: number, w: number, h: number) {
  const chart = spec.chart
  if (!chart || !chart.datasets.length || chart.labels.length === 0) return
  const ds = chart.datasets[0]
  const data = ds.data.map((v) => Math.max(0, Number(v) || 0))
  const max = Math.max(...data, 1)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...ACCENT)
  doc.text(chart.title.slice(0, 60), x, y - 2)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)

  if (chart.type === 'pie') {
    const cx = x + w / 2
    const cy = y + h / 2
    const r = Math.min(w, h) / 2 - 4
    const total = data.reduce((a, b) => a + b, 0)
    let angle = -Math.PI / 2
    for (let i = 0; i < data.length; i++) {
      if (total <= 0) break
      const sweep = (data[i] / total) * Math.PI * 2
      const segs = Math.max(2, Math.ceil(sweep / 0.2))
      const cmds: any[] = [['M', cx, cy]]
      for (let s = 0; s <= segs; s++) {
        const a = angle + (sweep * s) / segs
        cmds.push(['L', cx + Math.cos(a) * r, cy + Math.sin(a) * r])
      }
      cmds.push(['Z'])
      doc.setFillColor(...PALETTE[i % PALETTE.length])
      doc.setDrawColor(255, 255, 255)
      doc.setLineWidth(0.4)
      doc.path(cmds, 'FD')
      angle += sweep
    }
    let legendY = y
    for (let i = 0; i < Math.min(data.length, 6); i++) {
      doc.setFillColor(...PALETTE[i % PALETTE.length])
      doc.rect(x, legendY, 3, 3, 'F')
      doc.setTextColor(...MUTED)
      const val = ds.format === 'pkr' ? `PKR ${data[i].toLocaleString('en-PK')}` : data[i].toLocaleString('en-PK')
      doc.text(`${chart.labels[i].slice(0, 22)}  ${val}`, x + 5, legendY + 2.5)
      legendY += 5
    }
  } else {
    const n = data.length
    const slot = w / Math.max(n, 1)
    const barW = Math.min(slot * 0.6, 14)
    const grid = 4
    const chartH = h - grid * 3
    doc.setDrawColor(...MUTED)
    doc.setLineWidth(0.2)
    doc.line(x, y + chartH, x + w, y + chartH)
    for (let g = 0; g < grid; g++) {
      const gy = y + chartH - (chartH / grid) * g
      doc.setDrawColor(200, 202, 214)
      doc.line(x, gy, x + w, gy)
      doc.setTextColor(...MUTED)
      doc.setFontSize(6.5)
      const tick = ((max * g) / grid).toLocaleString('en-PK')
      doc.text(tick, x - 2, gy + 2, { align: 'right' })
    }
    for (let i = 0; i < n; i++) {
      const bh = (data[i] / max) * chartH
      const bx = x + slot * i + (slot - barW) / 2
      doc.setFillColor(...PALETTE[i % PALETTE.length])
      doc.rect(bx, y + chartH - bh, barW, bh, 'F')
      doc.setTextColor(...MUTED)
      doc.setFontSize(6)
      const label = chart.labels[i].slice(0, 10)
      doc.text(label, bx + barW / 2, y + chartH + 3.5, { align: 'center' })
    }
  }
}

export function downloadPdf(spec: FileSpec) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 40
  const contentW = pageW - margin * 2

  doc.setFillColor(...ACCENT)
  doc.rect(0, 0, pageW, 8, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(24, 26, 34)
  const title = doc.splitTextToSize(spec.title.slice(0, 90), contentW)
  doc.text(title, margin, 52)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...MUTED)
  doc.text(
    `${spec.rows.length} rows  ·  ${new Date(spec.generated_at).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })}  ·  Generated by Verafo`,
    margin,
    70,
  )

  let y = 82
  if (spec.description) {
    doc.setFontSize(10)
    doc.setTextColor(60, 64, 76)
    const desc = doc.splitTextToSize(spec.description.slice(0, 240), contentW)
    doc.text(desc, margin, y)
    y += desc.length * 12 + 4
  }

  const chartH = 150
  if (spec.chart && spec.chart.labels.length > 0 && spec.chart.datasets.length > 0) {
    drawPdfChart(doc, spec, margin, y, contentW, chartH)
    y += chartH + 16
  }

  autoTable(doc, {
    head: [spec.columns.map((c) => c.label)],
    body: spec.rows.map((r) => spec.columns.map((c) => cellLabel(c, r[c.key]))),
    startY: Math.min(y, doc.internal.pageSize.getHeight() - 60),
    margin: { left: margin, right: margin, top: 40, bottom: 40 },
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, textColor: [40, 44, 54], lineColor: [226, 228, 238] },
    headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [246, 248, 252] },
    didDrawPage: (data: any) => {
      const ph = data.doc.internal.pageSize.getHeight()
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...MUTED)
      doc.text(`Verafo · ${spec.title.slice(0, 50)} · ${data.pageNumber}`, margin, ph - 20)
    },
  })

  doc.save(filenameFor(spec, 'pdf'))
}

export function generateFile(format: 'pdf' | 'csv' | 'xlsx', spec: FileSpec) {
  if (format === 'pdf') downloadPdf(spec)
  else if (format === 'csv') downloadCsv(spec)
  else downloadExcel(spec)
}
