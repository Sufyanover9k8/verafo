import { CountUpNumber } from '../CountUpNumber'
import type { ProductStat } from '../../lib/storeStats'

interface TopProductsListProps {
  products: ProductStat[]
}

/** Top products by revenue — ranks, counts and amounts animate. */
export function TopProductsList({ products }: TopProductsListProps) {
  if (products.length === 0) {
    return <p className="text-[13.5px] text-muted-foreground">No products logged yet.</p>
  }
  return (
    <ol className="m-0 flex list-none flex-col divide-y divide-border p-0">
      {products.slice(0, 9).map((p, i) => (
        <li key={p.name} className="flex items-center gap-3 py-3">
          <span className="w-6 shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">#{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-[14px] font-medium text-foreground">{p.name}</span>
              {p.category && (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">
                  {p.category}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              <CountUpNumber value={p.orders} /> order{p.orders === 1 ? '' : 's'} · {p.share}% of sales
            </p>
          </div>
          <CountUpNumber className="shrink-0 font-mono text-[13.5px] tabular-nums text-foreground" prefix="PKR " value={p.revenue} />
        </li>
      ))}
    </ol>
  )
}
