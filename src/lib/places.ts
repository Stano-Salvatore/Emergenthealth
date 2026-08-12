// Saved-place matching — turns raw coordinates into "you're at Kaviareň Vták".

export interface PlaceLike {
  id: string
  name: string
  emoji: string
  lat: number
  lng: number
  radiusM: number
}

const EARTH_R = 6371000 // m

/** Great-circle distance in metres. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(s))
}

/**
 * The saved place the user is currently at: nearest one whose radius (plus a
 * little GPS slack) contains the position. Null when nowhere familiar.
 */
export function matchSavedPlace<T extends PlaceLike>(
  lat: number,
  lng: number,
  places: T[],
  accuracyM = 0,
): { place: T; distanceM: number } | null {
  let best: { place: T; distanceM: number } | null = null
  const slack = Math.min(accuracyM, 100) // terrible GPS shouldn't match half the city
  for (const p of places) {
    const d = distanceM(lat, lng, p.lat, p.lng)
    if (d > p.radiusM + slack) continue
    if (!best || d < best.distanceM) best = { place: p, distanceM: Math.round(d) }
  }
  return best
}
