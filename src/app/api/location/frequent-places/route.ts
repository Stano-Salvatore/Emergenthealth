import { NextRequest, NextResponse } from "next/server"
import { distanceM } from "@/lib/places"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const maxDuration = 30

// Places the user keeps being at, mined from their stored GPS points, so
// saved places (and the auto check-ins they drive) don't depend on someone
// thinking to add each one by hand.
//
// A "place" here is a ~100 m grid cell where the user was still (< 6 km/h)
// long enough to count as a dwell (≥ 15 min span or ≥ 5 points in a day), on
// at least three different days. That day threshold is what keeps commute
// stops out: a traffic light collects points daily but never a dwell.
//
// The result is cached for a day per user — the expensive parts are a
// full-table aggregate and Nominatim lookups (1 req/s courtesy), and the
// answer only changes as fast as someone's habits do.

const CACHE_KEY = "frequent_places_cache"
const CACHE_MS = 24 * 60 * 60 * 1000
const MERGE_METERS = 160
const MAX_CANDIDATES = 6

interface Candidate {
  lat: number
  lng: number
  days: number
  points: number
  firstSeen: string
  lastSeen: string
  name: string
  address: string | null
}

async function reverseGeocode(lat: number, lng: number): Promise<{ name: string; address: string | null }> {
  const fallback = { name: `Place near ${lat.toFixed(4)}, ${lng.toFixed(4)}`, address: null }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`
    const res = await fetch(url, { headers: { "User-Agent": "emergenthealth/1.0 (health dashboard)" } })
    if (!res.ok) return fallback
    const data = await res.json()
    const a = data.address ?? {}
    const poi = a.amenity ?? a.shop ?? a.leisure ?? a.building ?? null
    const road = a.road ? (a.house_number ? `${a.road} ${a.house_number}` : a.road) : null
    const locality = a.suburb ?? a.neighbourhood ?? a.village ?? a.town ?? a.city ?? null
    const name = poi ?? road ?? locality ?? fallback.name
    const address = typeof data.display_name === "string"
      ? data.display_name.split(",").slice(0, 3).join(",").trim()
      : null
    return { name, address }
  } catch {
    return fallback
  }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const force = new URL(req.url).searchParams.get("force") === "1"
  if (!force) {
    const cached = await prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: CACHE_KEY } },
      select: { value: true },
    }).catch(() => null)
    if (cached) {
      try {
        const parsed = JSON.parse(cached.value) as { computedAt: number; candidates: Candidate[] }
        if (Date.now() - parsed.computedAt < CACHE_MS) {
          return NextResponse.json({ candidates: parsed.candidates, cached: true })
        }
      } catch { /* stale or corrupt — recompute */ }
    }
  }

  // Dwell cells: (cell, day) pairs where the user lingered, then cells that
  // recur across days. UTC days, same convention as the rest of /api/location.
  const cells = await prisma.$queryRaw<{
    lat: number; lng: number; days: number; points: number; first_day: string; last_day: string
  }[]>`
    WITH cell_days AS (
      SELECT round(lat * 1000) AS glat,
             round(lng * 1000) AS glng,
             to_char("trackedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
             COUNT(*) AS pts,
             EXTRACT(EPOCH FROM (MAX("trackedAt") - MIN("trackedAt"))) AS span_s,
             AVG(lat) AS lat,
             AVG(lng) AS lng
      FROM "LocationPoint"
      WHERE "userId" = ${userId}
        AND "trackedAt" >= now() - INTERVAL '400 days'
        AND ("speedKmh" IS NULL OR "speedKmh" < 6)
      GROUP BY 1, 2, 3
    )
    SELECT AVG(lat)::float AS lat,
           AVG(lng)::float AS lng,
           COUNT(*)::int   AS days,
           SUM(pts)::int   AS points,
           MIN(day)        AS first_day,
           MAX(day)        AS last_day
    FROM cell_days
    WHERE span_s >= 900 OR pts >= 5
    GROUP BY glat, glng
    HAVING COUNT(*) >= 3
    ORDER BY days DESC, points DESC
    LIMIT 40
  `.catch(() => [] as { lat: number; lng: number; days: number; points: number; first_day: string; last_day: string }[])

  // A place straddling a cell border shows up as neighbouring cells — fold
  // anything within MERGE_METERS into the stronger cluster.
  const merged: typeof cells = []
  for (const c of cells) {
    const near = merged.find(m => distanceM(m.lat, m.lng, c.lat, c.lng) <= MERGE_METERS)
    if (near) {
      near.points += c.points
      near.days = Math.max(near.days, c.days)
      if (c.first_day < near.first_day) near.first_day = c.first_day
      if (c.last_day > near.last_day) near.last_day = c.last_day
    } else {
      merged.push({ ...c })
    }
  }

  // Already-saved places don't need suggesting.
  const savedPlaces = await prisma.savedPlace.findMany({
    where: { userId },
    select: { lat: true, lng: true, radiusM: true },
  }).catch(() => [])
  const fresh = merged.filter(c =>
    !savedPlaces.some(sp => distanceM(sp.lat, sp.lng, c.lat, c.lng) <= Math.max(sp.radiusM, 150) + 50),
  ).slice(0, MAX_CANDIDATES)

  // Nominatim asks for 1 req/s — sequential, and only for the shortlist.
  const candidates: Candidate[] = []
  for (const c of fresh) {
    const geo = await reverseGeocode(c.lat, c.lng)
    candidates.push({
      lat: c.lat, lng: c.lng, days: c.days, points: c.points,
      firstSeen: c.first_day, lastSeen: c.last_day,
      name: geo.name, address: geo.address,
    })
    if (fresh.indexOf(c) < fresh.length - 1) await new Promise(r => setTimeout(r, 1100))
  }

  const value = JSON.stringify({ computedAt: Date.now(), candidates })
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: CACHE_KEY } },
    create: { userId, key: CACHE_KEY, value },
    update: { value },
  }).catch(() => {})

  return NextResponse.json({ candidates, cached: false })
}
