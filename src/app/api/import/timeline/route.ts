import { NextRequest, NextResponse } from "next/server"
import { optionalNumber } from "@/lib/optional-number"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { recordPlaceVisits } from "@/lib/place-visits"

export const runtime = "nodejs"
export const maxDuration = 30

// Batched ingestion for Google Timeline takeout points. The takeout file
// itself never reaches the server — it can be far past the request body
// limit, so the browser parses it and streams the extracted points here in
// slices. Rows get deterministic ids derived from (user, time, place), which
// makes every re-run of the same import a no-op via skipDuplicates instead of
// a growing pile of duplicate points.

const MAX_BATCH = 1000

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
      id: `tl_${userId.slice(-8)}_${t}_${Math.round(lat * 1e7)}_${Math.round(lng * 1e7)}`,
      userId,
      lat,
      lng,
      accuracyM: optionalNumber(p.accuracyM, Math.round),
      altitudeM: optionalNumber(p.altitudeM),
      speedKmh: optionalNumber(p.speedKmh),
      trackedAt: new Date(t),
      source: "timeline",
    })
  }

  if (data.length === 0) return NextResponse.json({ ok: true, inserted: 0, received: raw.length })

  const res = await prisma.locationPoint.createMany({ data, skipDuplicates: true })

  // Back-fill check-ins for the span this batch covers, so imported history
  // shows up as visits straight away rather than waiting for a cron whose
  // look-back only reaches the last few hours.
  let checkIns = 0
  if (res.count > 0) {
    const times = data.map(d => d.trackedAt.getTime())
    const from = new Date(Math.min(...times))
    const to = new Date(Math.max(...times))
    const visits = await recordPlaceVisits(userId, from, to).catch(() => ({ created: 0 }))
    checkIns = visits.created
  }

  return NextResponse.json({ ok: true, inserted: res.count, received: raw.length, checkIns })
}
