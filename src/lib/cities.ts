export interface MapPoint {
  x: number
  y: number
}

/** Approximate lon/lat for Pakistani cities (used to place dots on the geo map). */
const CITY_COORDS: Record<string, [number, number]> = {
  karachi: [67.01, 24.86],
  hyderabad: [68.37, 25.38],
  'mirpur khas': [69.01, 25.53],
  sukkur: [68.87, 27.7],
  larkana: [68.21, 27.56],
  khuzdar: [66.65, 27.8],
  quetta: [66.99, 30.18],
  'dera ghazi khan': [70.64, 30.05],
  multan: [71.52, 30.16],
  khanewal: [71.93, 30.3],
  bahawalpur: [71.69, 29.4],
  'rahim yar khan': [70.3, 28.42],
  sargodha: [72.67, 32.08],
  sheikhupura: [73.99, 31.71],
  lahore: [74.34, 31.55],
  faisalabad: [73.13, 31.45],
  okara: [73.45, 30.81],
  sahiwal: [73.09, 30.66],
  sialkot: [74.54, 32.5],
  gujranwala: [74.19, 32.16],
  gujrat: [74.08, 32.57],
  rawalpindi: [73.04, 33.57],
  islamabad: [73.05, 33.68],
  abbotabad: [73.22, 34.15],
  mardan: [72.05, 34.2],
  peshawar: [71.58, 34.02],
  muzaffarabad: [73.47, 34.37],
  gilgit: [74.35, 35.92],
  gwadar: [62.33, 25.12],
}

const LON_MIN = 63.5
const LON_MAX = 76.5
const LAT_MIN = 24
const LAT_MAX = 36.5

function lonLatToPoint(lon: number, lat: number): MapPoint {
  const x = (lon - LON_MIN) / (LON_MAX - LON_MIN)
  const y = 1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }
}

/** Look up a (possibly unnormalised) city name's lon/lat, or null if unknown. */
export function cityLonLat(city: string | null | undefined): [number, number] | null {
  const key = (city ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const ll = CITY_COORDS[key]
  return ll ? [ll[0], ll[1]] : null
}

/** Map a (possibly unnormalised) city name to a normalised plot point, or null if unknown. */
export function cityPoint(city: string | null | undefined): MapPoint | null {
  const ll = cityLonLat(city)
  return ll ? lonLatToPoint(ll[0], ll[1]) : null
}
