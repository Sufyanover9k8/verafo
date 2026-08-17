import { CountUpNumber } from '../CountUpNumber'
import type { ProductStat } from '../../lib/storeStats'

interface TopProductsListProps {
  products: ProductStat[]
}

/** Top products by revenue — ranks, counts and amounts animate. */
export function TopProductsList({ products }: TopProductsListProps) {
  if (products.length === 0) return <span className="muted">No products logged yet.</span>
  return (
    <div className="prod-list">
      {products.slice(0, 9).map((p, i) => (
        <div className="prod-row" key={p.name}>
          <span className="prod-rank">#{i + 1}</span>
          <div className="prod-main">
            <div className="prod-head">
              <span className="prod-name">{p.name}</span>
              {p.category && <span className="chip">{p.category}</span>}
            </div>
            <div className="prod-meta">
              <CountUpNumber value={p.orders} /> order{p.orders === 1 ? '' : 's'} · {p.share}% of sales
            </div>
          </div>
          <CountUpNumber className="loc-value" prefix="PKR " value={p.revenue} />
        </div>
      ))}
    </div>
  )
}