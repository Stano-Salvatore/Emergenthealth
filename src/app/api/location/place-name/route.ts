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

/** ~1 km. Two trips to the same city share one cache entry and one lookup. */
function cacheKey(lat: number, lng: number): string {
  return `place_name:${lat.toFixed(2)},${lng.toFixed(2)}`
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

  const key = cacheKey(lat, lng)
  const cached = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key } },
    select: { value: true },
  }).catch(() => null)
  if (cached?.value) return NextResponse.json({ label: cached.value, cached: true })

  // zoom=10 is the town/city level. Naming a trip after the street it happened
  // to centre on would be worse than not naming it.
  //
  // accept-language=en because the default is the LOCAL language: a trip to
  // Athens came back as "Αθήνα, Ελλάς", which is correct and unreadable in a
  // list of English labels.
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=10`
    + `&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`
  const res = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null)
  if (!res?.ok) return NextResponse.json({ label: null, error: "lookup failed" }, { status: 502 })

  const data = await res.json().catch(() => null) as { address?: Record<string, string> } | null
  const a = data?.address ?? {}
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state ?? null
  const country = a.country ?? null
  const label = city && country ? `${city}, ${country}` : city ?? country ?? null

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
