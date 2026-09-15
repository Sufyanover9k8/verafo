import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { money } from '../../lib/format'
import { cityLonLat } from '../../lib/cities'
import type { CityStat } from '../../lib/storeStats'

// CARTO's free anonymous basemap tiles now require signing up for an API key
// (watermarked "API KEY REQUIRED" without one). Esri's dark-gray canvas tiles
// are free with no key/signup needed and give the same dark aesthetic.
const TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'
const LABELS_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'

interface CityMapProps {
  cities: CityStat[]
  height?: number
}

export function CityMap({ cities, height = 280 }: CityMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || mapRef.current) return

    const map = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
    })
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.tileLayer(TILE_URL, {
      maxZoom: 16,
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    }).addTo(map)
    L.tileLayer(LABELS_URL, { maxZoom: 16 }).addTo(map)

    const coords = cities
      .map((c) => cityLonLat(c.city))
      .filter((ll): ll is [number, number] => ll !== null)

    if (coords.length > 1) {
      map.fitBounds(L.latLngBounds(coords.map(([lon, lat]) => [lat, lon])), {
        padding: [42, 42],
        maxZoom: 7,
      })
    } else if (coords.length === 1) {
      map.setView([coords[0][1], coords[0][0]], 7)
    } else {
      map.setView([30.2, 70.5], 5)
    }

    const maxRevenue = Math.max(1, ...cities.map((c) => c.revenue))

    for (const c of cities) {
      const ll = cityLonLat(c.city)
      if (!ll) continue
      const top = c.revenue >= maxRevenue
      const size = 12 + Math.round(Math.sqrt(c.revenue / maxRevenue) * 18)
      const icon = L.divIcon({
        className: '',
        html: `<span class="city-map-pin${top ? ' top' : ''}" style="width:${size}px;height:${size}px"></span>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        popupAnchor: [0, -size / 2],
      })
      const marker = L.marker([ll[1], ll[0]], { icon })
      marker.bindPopup(
        `<div class="city-map-tip">
          <strong>${c.city}</strong>
          <span>${money(c.revenue)} · ${c.orders} order${c.orders === 1 ? '' : 's'}</span>
          <span>${c.share}% of sales</span>
        </div>`,
        { offset: L.point(0, -size / 2 - 8), closeButton: false, maxWidth: 230, className: 'city-map-popup' },
      )
      marker.addTo(map)
    }

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [cities])

  return <div ref={containerRef} className="city-map" style={{ height }} aria-label="Sales by city map" />
}