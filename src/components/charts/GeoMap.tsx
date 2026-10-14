import { lazy, Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { CityStat } from '../../lib/storeStats'

const CityMap = lazy(() => import('./CityMap').then((m) => ({ default: m.CityMap })))

interface GeoMapProps {
  cities: CityStat[]
  height?: number
}

export function GeoMap({ cities, height = 280 }: GeoMapProps) {
  return (
    <Suspense
      fallback={
        /* Placeholder in the map's own frame: same radius, border and surface,
           so swapping in the map does not shift the page. */
        <div
          className="grid place-items-center rounded-[16px] border border-border bg-muted text-muted-foreground"
          style={{ height }}
        >
          <Loader2 className="size-[18px] animate-spin" role="status" aria-label="Loading map" />
        </div>
      }
    >
      <CityMap cities={cities} height={height} />
    </Suspense>
  )
}
