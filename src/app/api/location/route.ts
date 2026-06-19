import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { getGpxTrackForDate, listGpxDates } from "@/lib/google-drive"
import { downsamplePoints } from "@/lib/gpx"
import { prisma } from "@/lib/prisma"

/** Haversine distance in metres between two GPS coordinates */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Auto-create CheckIns for saved places detected in the GPS track (idempotent) */
async function autoTagPlaces(
  userId: string,
  date: string,
  points: { lat: number; lon: number }[]
): Promise<{ id: string; name: string; emoji: string; isNew: boolean }[]> {
  const savedPlaces = await prisma.savedPlace.findMany({ where: { userId } })
  if (!savedPlaces.length || !points.length) return []

  const dayStart = new Date(`${date}T00:00:00Z`)
  const dayEnd   = new Date(`${date}T23:59:59Z`)

  const tagged: { id: string; name: string; emoji: string; isNew: boolean }[] = []

  for (const sp of savedPlaces) {
    const visited = points.some(p => haversineM(p.lat, p.lon, sp.lat, sp.lng) <= sp.radiusM)
    if (!visited) continue

    const existing = await prisma.checkIn.findFirst({
      where: { userId, savedPlaceId: sp.id, checkedAt: { gte: dayStart, lte: dayEnd } },
    })

    if (existing) {
      tagged.push({ id: sp.id, name: sp.name, emoji: sp.emoji, isNew: false })
      continue
    }

    await prisma.checkIn.create({
      data: {
        userId,
        place: sp.name,
        emoji: sp.emoji,
        note: "Auto-detected from GPS track",
        checkedAt: new Date(`${date}T12:00:00Z`),
        isAuto: true,
        savedPlaceId: sp.id,
      },
    })
    tagged.push({ id: sp.id, name: sp.name, emoji: sp.emoji, isNew: true })
  }

  return tagged
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)

  if (searchParams.get("list") === "1") {
    const dates = await listGpxDates(session.user.id)
    return NextResponse.json(dates)
  }

  const date = searchParams.get("date") ?? new Date().toISOString().split("T")[0]

  // Fetch OwnTracks points for the day
  const dayStart = new Date(`${date}T00:00:00Z`)
  const dayEnd   = new Date(`${date}T23:59:59Z`)
  const ownTracksRows = await prisma.locationPoint.findMany({
    where: { userId: session.user.id, trackedAt: { gte: dayStart, lte: dayEnd } },
    orderBy: { trackedAt: "asc" },
  })
  const ownTracksPoints = ownTracksRows.map(r => ({ lat: r.lat, lon: r.lng, time: r.trackedAt }))

  const track = await getGpxTrackForDate(session.user.id, date)

  if (!track && ownTracksPoints.length < 2) return NextResponse.json(null)

  // Merge GPX + OwnTracks, deduplicate by proximity
  const gpxPoints = track ? downsamplePoints(track.points, 400).map(p => ({ lat: p.lat, lon: p.lon })) : []
  const otDownsampled = downsamplePoints(
    ownTracksPoints.map(p => ({ lat: p.lat, lon: p.lon, time: p.time, ele: null })),
    400,
  ).map(p => ({ lat: p.lat, lon: p.lon }))

  // Prefer GPX if available, supplement with OwnTracks outside GPX time range
  const points = gpxPoints.length >= 2 ? gpxPoints : otDownsampled

  const allForTagging = [
    ...(track?.points ?? []).map(p => ({ lat: p.lat, lon: p.lon })),
    ...ownTracksPoints.map(p => ({ lat: p.lat, lon: p.lon })),
  ]
  const autoTagged = await autoTagPlaces(session.user.id, date, allForTagging).catch(() => [])

  return NextResponse.json({
    distanceKm:  track?.distanceKm  ?? calcDistanceKm(ownTracksPoints),
    durationMin: track?.durationMin ?? calcDurationMin(ownTracksPoints),
    movingMin:   track?.movingMin   ?? calcDurationMin(ownTracksPoints),
    maxSpeedKmh: track?.maxSpeedKmh ?? 0,
    avgSpeedKmh: track?.avgSpeedKmh ?? 0,
    startTime:   track?.startTime?.toISOString() ?? ownTracksPoints[0]?.time?.toISOString() ?? null,
    endTime:     track?.endTime?.toISOString()   ?? ownTracksPoints.at(-1)?.time?.toISOString() ?? null,
    points,
    autoTagged,
    source: gpxPoints.length >= 2 ? "gpx" : "owntracks",
  })
}

function calcDistanceKm(pts: { lat: number; lon: number }[]): number {
  let km = 0
  for (let i = 1; i < pts.length; i++) {
    const R = 6371, p = pts[i - 1], c = pts[i]
    const dLat = (c.lat - p.lat) * Math.PI / 180
    const dLon = (c.lon - p.lon) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * Math.PI / 180) * Math.cos(c.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    km += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  return km
}

function calcDurationMin(pts: { time: Date }[]): number {
  if (pts.length < 2) return 0
  return (pts.at(-1)!.time.getTime() - pts[0].time.getTime()) / 60_000
}
