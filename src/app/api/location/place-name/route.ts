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
import { placeNameKey, type NamePrecision } from "@/lib/places"

const UA = "emergenthealth/1.0 (health dashboard)"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const lat = Number(searchParams.get("lat"))
  const lng = Number(searchParams.get("lng"))
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return NextResponse.json({ error: "bad lat" }, { status: 400 })
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) return NextResponse.json({ error: "bad lng" }, { status: 400 })

  // Two precisions, because two questions are asked here: a trip wants the
  // city it was in, a stay on the day journey wants the street it happened on.
  // The key and its rounding live in lib/places, shared with everything that
  // READS this cache — see placeNameKey.
  const precision: NamePrecision = searchParams.get("precision") === "street" ? "street" : "city"
  const key = placeNameKey(lat, lng, precision)
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
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=${precision === "street" ? 17 : 10}`
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
