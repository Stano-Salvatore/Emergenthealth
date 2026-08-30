// Turning one coordinate into a name people use — "Prague", "Bratislava".
//
// Kept out of /api/location/days deliberately. Nominatim asks for at most one
// request a second and is slow enough to be felt, so naming a dozen trips
// inside the page load would cost the page ten seconds it does not otherwise
// need. The card renders first with dates and distances, then fills the names
// in one at a time. Each answer is cached for good, so this happens once per
// place and never again.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

const UA = "emergenthealth/1.0 (health dashboard)"

/**
 * Two precisions, because two questions are being asked here.
 *
 * A trip wants the city — "Prague" — and rounding to ~1 km means every trip to
 * the same city shares one cache entry and one lookup. A stay on the day
 * journey wants the street it happened on, which needs ~10 m and its own cache
 * namespace: rounded to 1 km, the café and the bar two streets away would
 * collide on one entry and the second one to be looked up would inherit the
 * first one's name.
 */
type Precision = "city" | "street"

const ZOOM: Record<Precision, number> = { city: 10, street: 17 }
const CACHE_DP: Record<Precision, number> = { city: 2, street: 4 }

function cacheKey(lat: number, lng: number, precision: Precision): string {
  const dp = CACHE_DP[precision]
  const prefix = precision === "city" ? "place_name" : "street_name"
  return `${prefix}:${lat.toFixed(dp)},${lng.toFixed(dp)}`
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const lat = Number(searchParams.get("lat"))
  const lng = Number(searchParams.get("lng"))
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return NextResponse.json({ error: "bad lat" }, { status: 400 })
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) return NextResponse.json({ error: "bad lng" }, { status: 400 })

  const precision: Precision = searchParams.get("precision") === "street" ? "street" : "city"
  const key = cacheKey(lat, lng, precision)
  const cached = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key } },
    select: { value: true },
  }).catch(() => null)
  if (cached?.value) return NextResponse.json({ label: cached.value, cached: true })

  // zoom=10 is the town/city level. Naming a TRIP after the street it happened
  // to centre on would be worse than not naming it; naming a STAY after the
  // city it was in would be useless, which is what zoom=17 is for.
  //
  // accept-language=en because the default is the LOCAL language: a trip to
  // Athens came back as "Αθήνα, Ελλάς", which is correct and unreadable in a
  // list of English labels.
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=${ZOOM[precision]}`
    + `&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`
  const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null)
  if (!res?.ok) return NextResponse.json({ label: null, error: "lookup failed" }, { status: 502 })

  const data = await res.json().catch(() => null) as
    { name?: string; address?: Record<string, string> } | null
  const a = data?.address ?? {}

  // A street lookup wants the smallest thing with a name on it. Nominatim
  // returns venue names here only when the coordinate lands squarely on a
  // mapped building, which a GPS centroid usually does not — so in practice
  // this is a street, and it is labelled as one rather than being passed off
  // as the name of the place. Naming the place itself is the user's job, and
  // there is a button on the journey for exactly that.
  const label = precision === "street"
    ? (data?.name?.trim() || a.road || a.pedestrian || a.footway || a.neighbourhood
        || a.suburb || a.city || null)
    : (() => {
        const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state ?? null
        const country = a.country ?? null
        return city && country ? `${city}, ${country}` : city ?? country ?? null
      })()

  // A miss is not cached: the next attempt should be allowed to succeed rather
  // than freezing "unknown" onto the place for ever.
  if (!label) return NextResponse.json({ label: null })

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key } },
    create: { userId, key, value: label },
    update: { value: label },
  }).catch(() => null)

  return NextResponse.json({ label, cached: false })
}
