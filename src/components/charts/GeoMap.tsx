import { lazy, Suspense } from 'react'
import { Icon } from '../Icon'
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
        <div className="city-map city-map--loading" style={{ height }}>
          <Icon name="refresh" size={18} className="spin" />
        </div>
      }
    >
      <CityMap cities={cities} height={height} />
    </Suspense>
  )
}