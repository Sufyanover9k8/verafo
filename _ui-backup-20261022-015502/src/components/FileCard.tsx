import { useState } from 'react'
import { ChartCard } from './ChartCard'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { FileColumn, FileSpec } from '../lib/types'

function cellText(col: FileColumn, value: string | number | undefined): string {
  if (value == null) return '—'
  if (typeof value === 'number') {
    if (col.format === 'pkr') return `${value.toLocaleString('en-PK')} PKR`
    if (col.format === 'percent') return `${Math.round(value)}%`
    if (col.format === 'number') return value.toLocaleString('en-PK')
    return String(value)
  }
  return String(value)
}

const KIND_LABEL: Record<FileSpec['kind'], string> = {
  pdf: 'PDF',
  csv: 'CSV',
  xlsx: 'Excel',
  excel: 'Excel',
}

/**
 * A file the assistant generated: what it is, a short preview of its rows, and
 * the download actions. The heavy export libraries are still imported only when
 * a format is actually requested.
 */
export function FileCard({ spec }: { spec: FileSpec }) {
  const [downloading, setDownloading] = useState<string | null>(null)

  async function handle(format: 'pdf' | 'csv' | 'xlsx') {
    if (downloading) return
    setDownloading(format)
    try {
      // jsPDF and SheetJS are only pulled into the bundle once a download is
      // actually requested, instead of riding along with the rest of Chat.
      const { generateFile } = await import('../lib/exports')
      generateFile(format, spec)
    } finally {
      setDownloading(null)
    }
  }

  const previewRows = spec.rows.slice(0, 8)
  const numeric = (c: FileColumn) => c.format === 'pkr' || c.format === 'percent' || c.format === 'number'

  return (
    <div className="rounded-[10px] border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11.5px] font-semibold tracking-wide text-foreground uppercase">
          {KIND_LABEL[spec.kind] ?? 'File'}
        </span>
        <span className="text-[12px] text-muted-foreground">
          {spec.rows.length} rows · {spec.columns.length} columns
        </span>
      </div>

      <p className="mt-2 text-[14px] font-semibold text-foreground">{spec.title}</p>
      {spec.description && <p className="mt-1 text-[13px] text-muted-foreground">{spec.description}</p>}
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        Generated{' '}
        {new Date(spec.generated_at).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>

      {previewRows.length > 0 && (
        <div className="mt-3 rounded-[10px] border border-border bg-card">
          {/* Preview only: a wide file scrolls inside this box, never the page. */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {spec.columns.map((c) => (
                    <TableHead key={c.key} className={numeric(c) ? 'text-end whitespace-nowrap' : 'whitespace-nowrap'}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.map((r, i) => (
                  <TableRow key={i}>
                    {spec.columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={numeric(c) ? 'text-end font-mono text-[12.5px] tabular-nums' : 'text-[12.5px]'}
                      >
                        {cellText(c, r[c.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {spec.rows.length > previewRows.length && (
            <p className="border-t border-border px-4 py-2 text-[11.5px] text-muted-foreground">
              + {spec.rows.length - previewRows.length} more rows in the file
            </p>
          )}
        </div>
      )}

      {spec.chart && spec.chart.labels.length > 0 && <ChartCard spec={spec.chart} />}

      <div className="mt-3 flex flex-wrap gap-2">
        {(['pdf', 'csv', 'xlsx'] as const).map((format, i) => (
          <Button
            key={format}
            size="sm"
            variant={i === 0 ? 'default' : 'outline'}
            className="h-11 px-3 md:h-9"
            disabled={downloading != null}
            onClick={() => void handle(format)}
          >
            {downloading === format ? 'Preparing…' : KIND_LABEL[format]}
          </Button>
        ))}
      </div>
    </div>
  )
}
