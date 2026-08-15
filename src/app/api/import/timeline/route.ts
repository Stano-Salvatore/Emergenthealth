import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

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
      accuracyM: Number.isFinite(Number(p.accuracyM)) ? Math.round(Number(p.accuracyM)) : null,
      altitudeM: Number.isFinite(Number(p.altitudeM)) ? Number(p.altitudeM) : null,
      speedKmh: Number.isFinite(Number(p.speedKmh)) ? Number(p.speedKmh) : null,
      trackedAt: new Date(t),
      source: "timeline",
    })
  }

  if (data.length === 0) return NextResponse.json({ ok: true, inserted: 0, received: raw.length })

  const res = await prisma.locationPoint.createMany({ data, skipDuplicates: true })
  return NextResponse.json({ ok: true, inserted: res.count, received: raw.length })
}
