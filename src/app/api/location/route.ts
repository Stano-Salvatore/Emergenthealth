import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { getGpxTrackForDate, listGpxDates } from "@/lib/google-drive"
import { downsamplePoints } from "@/lib/gpx"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr, zonedDayRange } from "@/lib/local-date"
import { detectStops, summariseTrack } from "@/lib/day-stops"
import { detectDwells, recordVisits } from "@/lib/place-visits"


/**
 * Check-ins for saved places the day's track actually stayed at.
 *
 * This used to have a rule of its own, and it was the wrong one: a SINGLE
 * point inside a saved place's radius created a check-in, stamped at noon UTC
 * because no real time was to hand. Driving past home logged a visit to it, at
 * 2pm local, whatever time you actually drove past — and it ran on every load
 * of this page, so the fabrications accumulated.
 *
 * Meanwhile lib/place-visits already decided the same question properly, with
 * a dwell threshold and the stay's real times, for points arriving from the
 * app. Two rules for one event, disagreeing. Now there is one, and this hands
 * it the merged GPX-and-app track so an imported Timeline is judged the same
 * way a phone is.
 */
async function tagPlacesFromTrack(
  userId: string,
  points: { lat: number; lng: number; accuracyM: number | null; trackedAt: Date }[],
): Promise<{ id: string; name: string; emoji: string; isNew: boolean }[]> {
  if (points.length === 0) return []
  const places = await prisma.savedPlace.findMany({
    where: { userId },
    select: { id: true, name: true, emoji: true, lat: true, lng: true, radiusM: true },
  })
  if (places.length === 0) return []

  const { places: touched } = await recordVisits(userId, detectDwells(points, places))
  return touched
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const timezone = await getUserTimezone(session.user.id)

  if (searchParams.get("list") === "1") {
    // GPX days from Drive plus days with stored points (OwnTracks live
    // tracking or a Timeline import) — without the latter, imported history
    // existed but nothing on the page revealed which days had it.
    const gpxDates = await listGpxDates(session.user.id)
    const pointDays = await prisma.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT to_char("trackedAt" AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day
      FROM "LocationPoint" WHERE "userId" = ${session.user.id}
    `.catch(() => [] as { day: string }[])
    const merged = [...new Set([...gpxDates, ...pointDays.map(r => r.day)])]
      .sort()
      .reverse()
      .slice(0, 30)
    return NextResponse.json(merged)
  }

  const date = searchParams.get("date") ?? localDateStr(timezone)

  // A day is the user's day, not UTC's. At Bratislava's +02:00 the UTC window
  // started at 02:00 local and ended at 02:00 the next morning, so an evening
  // after midnight landed on the wrong date and the first two hours of every
  // date belonged to the day before.
  const { start: dayStart, end: dayEnd } = zonedDayRange(timezone, date)
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

  // The merged track WITH its times kept. A dwell is a duration, so points
  // stripped of when they happened cannot be judged at all — which is why the
  // rule this replaces could only ever ask "was I ever within the radius".
  const allForTagging = [
    ...(track?.points ?? [])
      .filter(p => p.time)
      .map(p => ({ lat: p.lat, lng: p.lon, accuracyM: null, trackedAt: new Date(p.time as unknown as Date) })),
    ...ownTracksRows.map(r => ({ lat: r.lat, lng: r.lng, accuracyM: r.accuracyM, trackedAt: r.trackedAt })),
  ].sort((a, b) => a.trackedAt.getTime() - b.trackedAt.getTime())
  const autoTagged = await tagPlacesFromTrack(session.user.id, allForTagging).catch(() => [])

  // Where the day was actually spent. Computed on the FULL timestamped series,
  // never the downsampled one: dropping every second fix leaves the shape
  // intact and the durations wrong, and a stop is nothing but a duration.
  const timedPoints = track?.points?.length
    ? track.points.filter(p => p.time).map(p => ({ lat: p.lat, lon: p.lon, time: new Date(p.time as unknown as Date) }))
    : ownTracksPoints
  const stops = detectStops(timedPoints)

  const summary = summariseTrack(ownTracksPoints, stops)
  const totalMin = calcDurationMin(ownTracksPoints)

  return NextResponse.json({
    distanceKm:  track?.distanceKm  ?? summary.distanceKm,
    durationMin: track?.durationMin ?? totalMin,
    movingMin:   track?.movingMin   ?? summary.movingMin,
    maxSpeedKmh: track?.maxSpeedKmh ?? summary.maxSpeedKmh,
    // Distance over time actually spent moving. Left at 0 when nothing moved,
    // rather than dividing by a zero denominator and reporting Infinity.
    avgSpeedKmh: track?.avgSpeedKmh ?? (summary.movingMin > 0 ? summary.distanceKm / (summary.movingMin / 60) : 0),
    startTime:   track?.startTime?.toISOString() ?? ownTracksPoints[0]?.time?.toISOString() ?? null,
    endTime:     track?.endTime?.toISOString()   ?? ownTracksPoints.at(-1)?.time?.toISOString() ?? null,
    points,
    stops: stops.map(st => ({
      lat: st.lat,
      lon: st.lon,
      start: st.start.toISOString(),
      end: st.end.toISOString(),
      minutes: st.minutes,
    })),
    autoTagged,
    source: gpxPoints.length >= 2 ? "gpx" : "owntracks",
  })
}



function calcDurationMin(pts: { time: Date }[]): number {
  if (pts.length < 2) return 0
  return (pts.at(-1)!.time.getTime() - pts[0].time.getTime()) / 60_000
}
