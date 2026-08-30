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


/**
 * Where a reverse-geocoded label is cached, as a UserPreference key.
 *
 * Built here rather than at each call site because a reader and a writer that
 * disagree about this string fail silently and expensively: the lookup is
 * saved under one key, every later read misses, and Nominatim is asked the
 * same question for ever.
 *
 * Two precisions with separate namespaces and separate rounding. A trip wants
 * the city and rounds to ~1 km so every visit to it shares one entry; a stay
 * wants the street and needs ~10 m, because at 1 km the café and the bar two
 * streets away collide on one entry and the second inherits the first's name.
 */
export type NamePrecision = "city" | "street"

const NAME_CACHE: Record<NamePrecision, { prefix: string; dp: number }> = {
  city: { prefix: "place_name", dp: 2 },
  street: { prefix: "street_name", dp: 4 },
}

export function placeNameKey(lat: number, lng: number, precision: NamePrecision): string {
  const { prefix, dp } = NAME_CACHE[precision]
  return `${prefix}:${lat.toFixed(dp)},${lng.toFixed(dp)}`
}
