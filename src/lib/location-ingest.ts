import { optionalNumber } from "@/lib/optional-number"
import { prisma } from "@/lib/prisma"
import { recordPlaceVisits, DETECTION_LOOKBACK_MIN } from "@/lib/place-visits"

// Where the phone's own background tracking lands, whichever path it took.
//
// Two routes feed this: /api/location/points on the session cookie (the
// WebView uploader) and /api/widget/location on the widget key (the native
// service, which has no session and keeps running after the app is closed).
// They must write identical rows, or the same walk uploaded by both halves
// during a hand-over would land twice — so the row building lives here, once.
//
// Ids are derived from (user, time, position) exactly as the Timeline importer
// does, so a batch that times out and gets retried is a no-op rather than a
// second copy of the same walk.

export const MAX_BATCH = 200

/** Matches the place-checkins cron's cadence; see claimDetectionSlot. */
const DETECT_EVERY_MIN = 10
const DETECT_KEY = "location_detect_at"

export interface InPoint {
  lat: number
  lng: number
  trackedAt: string
  accuracyM?: number | null
  altitudeM?: number | null
  speedKmh?: number | null
}

export interface IngestResult {
  inserted: number
  received: number
  checkIns: number
}

export async function ingestLocationPoints(userId: string, points: unknown): Promise<IngestResult> {
  const raw = Array.isArray(points) ? (points as InPoint[]).slice(0, MAX_BATCH) : []
  if (raw.length === 0) return { inserted: 0, received: 0, checkIns: 0 }

  const data = []
  for (const p of raw) {
    if (typeof p !== "object" || p === null) continue
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    const t = Date.parse(String(p.trackedAt))
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

  if (data.length === 0) return { inserted: 0, received: raw.length, checkIns: 0 }

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

  return { inserted: res.count, received: raw.length, checkIns }
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
