import { auth } from "@/auth"
import { NextResponse } from "next/server"
import { getGpxTrackForDate, listGpxDates } from "@/lib/google-drive"
import { downsamplePoints } from "@/lib/gpx"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr, zonedDayRange } from "@/lib/local-date"
import { detectStops, summariseTrack } from "@/lib/day-stops"
import { detectDwells, recordVisits } from "@/lib/place-visits"
import {
  applyKnownModes, buildJourney, modeFixKey, MODE_FIX_PREFIX, stravaMode, type KnownMode,
} from "@/lib/day-journeys"
import { matchSavedPlace, type PlaceLike } from "@/lib/places"


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
  places: SavedPlaceRow[],
): Promise<{ id: string; name: string; emoji: string; isNew: boolean }[]> {
  if (points.length === 0) return []
  if (places.length === 0) return []

  const { places: touched } = await recordVisits(userId, detectDwells(points, places))
  return touched
}

type SavedPlaceRow = PlaceLike

/**
 * The day as a sentence rather than a shape: at home, walking, on a bus, at
 * the café. lib/day-journeys fills in what happened between the stops the map
 * already draws, and everything below is about making those segments say a
 * name instead of a coordinate.
 *
 * Three sources of truth, in ascending order of how much they should be
 * believed, each overriding the last:
 *
 *  1. inference from the track — always available, sometimes wrong
 *  2. a Strava activity covering the move — the phone knew, we just asked late
 *  3. the user's own correction — final, and the only way a bus becomes a bus
 *
 * Names work the same way: a saved place wins outright, and everything else is
 * left null for the client to reverse-geocode lazily. Naming a stay here would
 * put a Nominatim round trip per stop inside this page load, and its courtesy
 * limit is one request a second — five stops would cost the day view five
 * seconds it does not otherwise need.
 */
async function describeJourney(
  userId: string,
  date: string,
  timedPoints: { lat: number; lon: number; time: Date }[],
  stops: ReturnType<typeof detectStops>,
  places: SavedPlaceRow[],
  dayStart: Date,
  dayEnd: Date,
) {
  const segments = buildJourney(timedPoints, stops)
  if (segments.length === 0) return []

  // Strava, by the times it actually happened rather than by its `day` column:
  // that column is a string, and an evening ride either side of midnight is
  // exactly the case where a stored day and the user's day disagree.
  const activities = await prisma.stravaActivity.findMany({
    where: { userId, startDate: { gte: dayStart, lte: dayEnd } },
    select: { type: true, startDate: true, elapsedTimeSec: true },
  }).catch(() => [])

  const known: KnownMode[] = []
  for (const a of activities) {
    const mode = stravaMode(a.type)
    if (!mode) continue
    known.push({
      start: a.startDate,
      end: new Date(a.startDate.getTime() + a.elapsedTimeSec * 1000),
      mode,
    })
  }

  // Corrections, keyed by the local day so a lookup stays one day's worth
  // however many years of them accumulate.
  const corrections = await prisma.userPreference.findMany({
    where: { userId, key: { startsWith: `${MODE_FIX_PREFIX}${date}:` } },
    select: { key: true, value: true },
  }).catch(() => [])

  const fixed = applyKnownModes(segments, known)
  const byStart = new Map(corrections.map(c => [c.key.slice(modeFixKey(date, "").length), c.value]))

  return fixed.map(seg => {
    if (seg.kind === "stay") {
      const match = matchSavedPlace(seg.lat, seg.lon, places)
      return {
        kind: "stay" as const,
        start: seg.start.toISOString(),
        end: seg.end.toISOString(),
        minutes: seg.minutes,
        lat: seg.lat,
        lon: seg.lon,
        label: match?.place.name ?? null,
        emoji: match?.place.emoji ?? null,
        savedPlaceId: match?.place.id ?? null,
      }
    }
    if (seg.kind === "gap") {
      return {
        kind: "gap" as const,
        start: seg.start.toISOString(),
        end: seg.end.toISOString(),
        minutes: seg.minutes,
      }
    }
    const corrected = byStart.get(seg.start.toISOString())
    return {
      kind: "move" as const,
      start: seg.start.toISOString(),
      end: seg.end.toISOString(),
      minutes: seg.minutes,
      mode: corrected ?? seg.mode,
      confidence: corrected ? ("known" as const) : seg.confidence,
      distanceM: seg.distanceM,
      topKmh: seg.topKmh,
      avgKmh: seg.avgKmh,
    }
  })
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
    // trackedAt is `timestamp WITHOUT time zone` holding UTC (Prisma's default
    // mapping; only the six fields marked @db.Timestamptz differ). One
    // AT TIME ZONE therefore READS it as local and shifts it the wrong way:
    // 00:30 UTC on the 29th came out as 22:30 on the 28th instead of 02:30 on
    // the 29th. The first conversion says what it is, the second says where to
    // read it — and only then does this list agree with the day it opens.
    const pointDays = await prisma.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT to_char(("trackedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day
      FROM "LocationPoint" WHERE "userId" = ${session.user.id}
    `.catch(() => [] as { day: string }[])
    // Every day with tracking, not the most recent thirty.
    //
    // A Google Timeline import is years of history, and the page reached it
    // through a list of thirty chips and a one-day-back arrow — so anything
    // older than a month was present in the database and unreachable without
    // several hundred clicks. The page shows the recent ones as chips and
    // offers the rest through a date picker bounded by this list, which needs
    // to know the real extent of the data to bound anything.
    //
    // One string per tracked day: a decade of daily tracking is under 40 KB.
    const merged = [...new Set([...gpxDates, ...pointDays.map(r => r.day)])]
      .sort()
      .reverse()
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
  // Fetched once and shared: the auto check-ins and the journey's stay names
  // are asking the same question of the same handful of rows.
  const savedPlaces = await prisma.savedPlace.findMany({
    where: { userId: session.user.id },
    select: { id: true, name: true, emoji: true, lat: true, lng: true, radiusM: true },
  }).catch(() => [] as SavedPlaceRow[])

  const autoTagged = await tagPlacesFromTrack(session.user.id, allForTagging, savedPlaces).catch(() => [])

  // Where the day was actually spent. Computed on the FULL timestamped series,
  // never the downsampled one: dropping every second fix leaves the shape
  // intact and the durations wrong, and a stop is nothing but a duration.
  // Chosen on whether the GPX actually carries times, not on whether it has
  // points. A track exported without <time> elements filtered to nothing and
  // took the app's own timestamped series down with it, so a fully tracked day
  // shipped no stops at all and the whole panel vanished.
  const gpxTimed = (track?.points ?? [])
    .filter(p => p.time)
    .map(p => ({ lat: p.lat, lon: p.lon, time: new Date(p.time as unknown as Date) }))
  const timedPoints = gpxTimed.length >= 2 ? gpxTimed : ownTracksPoints
  const stops = detectStops(timedPoints)

  const journey = await describeJourney(
    session.user.id, date, timedPoints, stops, savedPlaces, dayStart, dayEnd,
  ).catch(() => [])

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
    journey,
    autoTagged,
    source: gpxPoints.length >= 2 ? "gpx" : "owntracks",
  })
}



function calcDurationMin(pts: { time: Date }[]): number {
  if (pts.length < 2) return 0
  return (pts.at(-1)!.time.getTime() - pts[0].time.getTime()) / 60_000
}
