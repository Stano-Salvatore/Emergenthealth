import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { recordPlaceVisits } from "@/lib/place-visits"

export const runtime = "nodejs"
export const maxDuration = 30

// Where the phone's own background tracking lands.
//
// OwnTracks posts to /api/location/track with an API key because it is a
// separate app that knows nothing about the session. This is our own app, so it
// posts a batch on the session cookie instead — no key to paste, nothing to
// leak, and the user never has to set anything up beyond one toggle.
//
// Ids are derived from (user, time, position) exactly as the Timeline importer
// does, so a batch that times out and gets retried is a no-op rather than a
// second copy of the same walk.

const MAX_BATCH = 200

interface InPoint {
  lat: number
  lng: number
  trackedAt: string
  accuracyM?: number | null
  altitudeM?: number | null
  speedKmh?: number | null
}

/**
 * A missing reading stays missing.
 *
 * `Number(null)` is 0 and `Number.isFinite(0)` is true, so the obvious
 * coercion turns "this phone reported no altitude" into "this phone was at sea
 * level". The plugin types altitude and speed as nullable and does send nulls.
 */
function optionalNumber(value: unknown, round?: (n: number) => number): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return round ? round(n) : n
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  let body: { points?: InPoint[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const raw = Array.isArray(body.points) ? body.points.slice(0, MAX_BATCH) : []
  if (raw.length === 0) return NextResponse.json({ error: "No points" }, { status: 400 })

  const data = []
  for (const p of raw) {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    const t = Date.parse(p.trackedAt)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) continue
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) continue
    if (!Number.isFinite(t)) continue

    data.push({
      id: `bg_${userId.slice(-8)}_${t}_${Math.round(lat * 1e7)}_${Math.round(lng * 1e7)}`,
      userId,
      lat,
      lng,
      accuracyM: optionalNumber(p.accuracyM, Math.round),
      altitudeM: optionalNumber(p.altitudeM),
      speedKmh: optionalNumber(p.speedKmh),
      trackedAt: new Date(t),
      source: "app",
    })
  }

  if (data.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, received: raw.length })
  }

  const res = await prisma.locationPoint.createMany({ data, skipDuplicates: true })

  // Detect visits over the span this batch covers, so a check-in can appear
  // while you are still sitting in the café rather than an hour after you left.
  //
  // This runs every few minutes against a stay that is still growing, and each
  // pass sees a slightly longer version of the same dwell. That only stays at
  // one check-in because recordPlaceVisits matches an existing one anywhere
  // inside the span rather than near its midpoint — see DEDUPE_MIN. It did not,
  // once, and this wrote a fresh check-in every ninety minutes of one stay.
  const times = data.map(d => d.trackedAt.getTime())
  const from = new Date(Math.min(...times) - 90 * 60_000)
  const to = new Date(Math.max(...times))
  const visits = await recordPlaceVisits(userId, from, to).catch(() => ({ created: 0, detected: 0 }))

  return NextResponse.json({
    ok: true,
    inserted: res.count,
    received: raw.length,
    checkIns: visits.created,
  })
}
