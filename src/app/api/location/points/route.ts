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
      accuracyM: Number.isFinite(Number(p.accuracyM)) ? Math.round(Number(p.accuracyM)) : null,
      altitudeM: Number.isFinite(Number(p.altitudeM)) ? Number(p.altitudeM) : null,
      speedKmh: Number.isFinite(Number(p.speedKmh)) ? Number(p.speedKmh) : null,
      trackedAt: new Date(t),
      source: "app",
    })
  }

  if (data.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0, received: raw.length })
  }

  const res = await prisma.locationPoint.createMany({ data, skipDuplicates: true })

  // Detect visits over the span this batch covers. The cron does this too, on
  // its own tick — but a check-in that appears while you are still sitting in
  // the café is worth more than one that appears an hour after you left, and
  // recordPlaceVisits won't duplicate what either of them already found.
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
