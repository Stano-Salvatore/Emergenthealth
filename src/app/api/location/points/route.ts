import { NextRequest, NextResponse } from "next/server"
import { optionalNumber } from "@/lib/optional-number"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { recordPlaceVisits, DETECTION_LOOKBACK_MIN } from "@/lib/place-visits"

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

/** Matches the place-checkins cron's cadence; see claimDetectionSlot. */
const DETECT_EVERY_MIN = 10
const DETECT_KEY = "location_detect_at"

interface InPoint {
  lat: number
  lng: number
  trackedAt: string
  accuracyM?: number | null
  altitudeM?: number | null
  speedKmh?: number | null
}

/**
 * When the server last heard anything, and how much of today it has.
 *
 * Tracking failing looks exactly like tracking working: the notification stays
 * up, the switch still says "Stop following along", and the points simply stop.
 * Today's first real journey logged sixteen fixes on a bus and then nothing for
 * forty minutes of sitting still, and the only reason anyone noticed was a
 * screenshot of the map. The app should be able to say it itself.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const newest = await prisma.locationPoint.findFirst({
    where: { userId, source: "app" },
    orderBy: { trackedAt: "desc" },
    select: { trackedAt: true },
  }).catch(() => null)

  const since = new Date(Date.now() - 24 * 60 * 60_000)
  const recent = await prisma.locationPoint.count({
    where: { userId, source: "app", trackedAt: { gte: since } },
  }).catch(() => 0)

  return NextResponse.json({
    lastPointAt: newest?.trackedAt?.toISOString() ?? null,
    lastDayCount: recent,
  })
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
  // while you are still sitting in the café rather than after the next tick.
  //
  // Rate-limited, because it is a safety net rather than the main path. The
  // place-checkins cron already runs every ten minutes against a twenty-minute
  // dwell threshold, so per-batch detection only earns its keep when that tick
  // is late — which GitHub Actions often is. Left unbounded it was the opposite
  // of cheap: a batch arrives per five minutes when you are still, but every
  // 200 m when you are moving, and each pass re-reads a full day of points.
  //
  // It settles on a single check-in only because two things hold together: the
  // look-back reaches the stay's real start (DETECTION_LOOKBACK_MIN) and the
  // dedupe matches anywhere inside the resulting span (DEDUPE_MIN). Either
  // alone is not enough, which is how the first attempt wrote four check-ins
  // for one night.
  let checkIns = 0
  if (await claimDetectionSlot(userId)) {
    const times = data.map(d => d.trackedAt.getTime())
    const from = new Date(Math.min(...times) - DETECTION_LOOKBACK_MIN * 60_000)
    const to = new Date(Math.max(...times))
    const visits = await recordPlaceVisits(userId, from, to).catch(() => ({ created: 0, detected: 0 }))
    checkIns = visits.created
  }

  return NextResponse.json({
    ok: true,
    inserted: res.count,
    received: raw.length,
    checkIns,
  })
}

/**
 * True at most once per DETECT_EVERY_MIN per user.
 *
 * Stored as a UserPreference, like the other small per-user bookkeeping in this
 * app, so it needs no new table. Failing open would reintroduce the unbounded
 * scan on exactly the runs where the database is already unhappy, so a failure
 * here skips detection: the cron will pick the stay up regardless.
 */
async function claimDetectionSlot(userId: string): Promise<boolean> {
  const now = Date.now()
  try {
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "UserPreference"
      WHERE "userId" = ${userId} AND "key" = ${DETECT_KEY} LIMIT 1
    `
    const last = Number(rows[0]?.value ?? 0)
    if (Number.isFinite(last) && now - last < DETECT_EVERY_MIN * 60_000) return false
    const stamp = String(now)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, ${DETECT_KEY}, ${stamp})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${stamp}
    `
    return true
  } catch {
    return false
  }
}
