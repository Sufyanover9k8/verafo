import { useState } from 'react'
import { ChartCard } from './ChartCard'
import { Icon } from './Icon'
import { generateFile } from '../lib/exports'
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

export function FileCard({ spec }: { spec: FileSpec }) {
  const [downloading, setDownloading] = useState<string | null>(null)

  async function handle(format: 'pdf' | 'csv' | 'xlsx') {
    if (downloading) return
    setDownloading(format)
    try {
      await new Promise((r) => window.setTimeout(r, 30))
      generateFile(format, spec)
    } finally {
      setDownloading(null)
    }
  }

  const previewRows = spec.rows.slice(0, 8)

  return (
    <div className="file-card">
      <div className="file-head">
        <span className="file-badge">
          <Icon name="document-text-outline" size={16} />
          {KIND_LABEL[spec.kind] ?? 'File'}
        </span>
        <span className="file-meta">
          {spec.rows.length} rows · {spec.columns.length} columns
        </span>
      </div>
      <div className="file-title">{spec.title}</div>
      {spec.description && <div className="file-desc">{spec.description}</div>}
      <div className="file-generated">
        Generated {new Date(spec.generated_at).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>

      {previewRows.length > 0 && (
        <div className="file-preview">
          <table>
            <thead>
              <tr>
                {spec.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((r, i) => (
                <tr key={i}>
                  {spec.columns.map((c) => (
                    <td key={c.key}>{cellText(c, r[c.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {spec.rows.length > previewRows.length && (
            <div className="file-more">+ {spec.rows.length - previewRows.length} more rows in the file</div>
          )}
        </div>
      )}

      {spec.chart && spec.chart.labels.length > 0 && <ChartCard spec={spec.chart} />}

      <div className="file-actions">
        <button className="btn btn-sm file-dl primary" disabled={!!downloading} onClick={() => void handle('pdf')}>
          <Icon name="download-outline" size={13} />
          {downloading === 'pdf' ? 'Preparing…' : 'PDF'}
        </button>
        <button className="btn btn-sm ghost" disabled={!!downloading} onClick={() => void handle('csv')}>
          <Icon name="download-outline" size={13} />
          {downloading === 'csv' ? 'Preparing…' : 'CSV'}
        </button>
        <button className="btn btn-sm ghost" disabled={!!downloading} onClick={() => void handle('xlsx')}>
          <Icon name="download-outline" size={13} />
          {downloading === 'xlsx' ? 'Preparing…' : 'Excel'}
        </button>
      </div>
    </div>
  )
}
