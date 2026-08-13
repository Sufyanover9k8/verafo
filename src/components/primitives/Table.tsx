import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  label: string
  render?: (row: T) => ReactNode
  /** mono + left-aligned (identifiers) */
  id?: boolean
  /** mono + right-aligned (numeric values) */
  num?: boolean
  className?: string
}

interface TableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, i: number) => string
  responsive?: boolean
  empty?: ReactNode
  onRowKeyDown?: (row: T, key: string) => void
  rowClassName?: (row: T) => string | undefined
}

export function Table<T>({ columns, rows, rowKey, responsive = true, empty, onRowKeyDown, rowClassName }: TableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>
  return (
    <div className="table-wrap">
      <table className={responsive ? 'table responsive' : 'table'}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? 'num' : ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              tabIndex={onRowKeyDown ? 0 : undefined}
              onKeyDown={
                onRowKeyDown
                  ? (e) => {
                      if (e.key === 'a' || e.key === 'A' || e.key === 'r' || e.key === 'R') {
                        e.preventDefault()
                        onRowKeyDown(row, e.key.toLowerCase())
                      }
                    }
                  : undefined
              }
              className={rowClassName?.(row)}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  data-label={c.label}
                  className={[c.num ? 'num' : '', c.id ? 'id' : '', c.className ?? ''].filter(Boolean).join(' ')}
                >
                  {c.render ? c.render(row) : (row as Record<string, unknown>)[c.key] as ReactNode}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
