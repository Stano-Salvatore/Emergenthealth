// Every source that actually KNOWS how a stretch of the day was travelled,
// gathered once, for everyone who draws or describes a journey.
//
// Three feeds, and the overlay in lib/day-journeys arbitrates between them:
//
//   Strava activities — the user recorded the run or the ride themselves.
//   ActivitySpans from a Google Timeline import — map-matched, so they can
//     say IN_BUS, the one thing nothing else can.
//   ActivitySpans from the phone's Activity Recognition — live sensor
//     classification; its IN_VEHICLE spans arrive vehicleOnly, refining the
//     bus/car guess without pretending to settle it.
//
// One loader rather than each caller's own queries, because the location page
// and Emergy's get_day_journey tool describe the same day: two loaders is how
// they would eventually describe two different ones.

import { prisma } from "@/lib/prisma"
import { stravaMode, type KnownMode } from "@/lib/day-journeys"
import type { TravelMode } from "@/lib/day-journeys"

const SPAN_MODES: ReadonlySet<string> = new Set([
  "walk", "run", "cycle", "transit", "drive", "train", "flight",
])

export async function loadKnownModes(userId: string, from: Date, to: Date): Promise<KnownMode[]> {
  const [activities, spans] = await Promise.all([
    // Strava by the times it actually happened rather than its `day` string:
    // an evening ride either side of midnight is exactly where those differ.
    prisma.stravaActivity.findMany({
      where: { userId, startDate: { gte: from, lte: to } },
      select: { type: true, startDate: true, elapsedTimeSec: true },
    }).catch(() => []),
    // Overlapping the window, not contained in it — a span that started
    // before local midnight still describes this day's first minutes.
    prisma.activitySpan.findMany({
      where: { userId, start: { lte: to }, end: { gte: from } },
      select: { start: true, end: true, mode: true, vehicleOnly: true },
    }).catch(() => []),
  ])

  const known: KnownMode[] = []
  for (const a of activities) {
    const mode = stravaMode(a.type)
    if (!mode) continue
    known.push({ start: a.startDate, end: new Date(a.startDate.getTime() + a.elapsedTimeSec * 1000), mode })
  }
  for (const s of spans) {
    // The column is a string; a row written by a future version with a mode
    // this build has no word for must not crash the page, just say nothing.
    if (!SPAN_MODES.has(s.mode)) continue
    known.push({ start: s.start, end: s.end, mode: s.mode as TravelMode, vehicleOnly: s.vehicleOnly })
  }
  return known
}
