// Turning stored GPS points into check-ins, without anyone opening the app.
//
// Place check-ins used to need the dashboard open: it sampled the position
// once every couple of hours and logged wherever you were. A coffee at a
// saved café that you never opened the app around simply never happened, and
// imported history produced nothing until you scrolled to that day's map.
//
// This reads the points the app already stores — OwnTracks in the background,
// or a Google Timeline import — and records the visits in them.
//
// A visit is a *dwell*: consecutive points inside one saved place, spanning at
// least MIN_DWELL_MIN. Passing the café on the tram makes one or two points
// and no dwell, so it logs nothing. Leaving and coming back later is two
// visits, because the gap between them breaks the run.

import { prisma } from "@/lib/prisma"
import { matchSavedPlace, type PlaceLike } from "@/lib/places"

/** Below this, it's passing through rather than being somewhere. */
export const MIN_DWELL_MIN = 20

/**
 * A gap this long ends the current dwell even inside the same place: tracking
 * is sparse, and without it a morning and an evening at home would merge into
 * one 12-hour "visit" that lands at neither time.
 */
export const MAX_GAP_MIN = 90

/**
 * Padding around a dwell when looking for a check-in that already covers it.
 *
 * This used to compare against the visit's MIDPOINT, which is stable only once
 * the visit has ended. Detection now also runs per upload batch, where the same
 * stay is seen again and again while it is still growing — and a growing dwell's
 * midpoint advances, walking out of its own match window and writing a fresh
 * check-in every so often. A night at home became a column of them.
 *
 * Matching against the whole span instead is stable: the first check-in for a
 * stay falls inside every later, longer view of that same stay. Padding by the
 * same 90 minutes that ends a dwell (MAX_GAP_MIN) keeps two genuinely separate
 * visits separate, since anything closer than that never split in two.
 */
export const DEDUPE_MIN = 90

/**
 * How far back a detection pass must look.
 *
 * Not "how stale may a visit be" — how far back the START of a stay that is
 * still in progress could be. Detection re-runs against a growing stay, and a
 * window shorter than the stay truncates its start; the check-in already
 * written then falls outside dedupeWindow and the same night is recorded again.
 * Measured at four check-ins for a ten-hour night with a 90-minute window, and
 * a 12-hour window still splits anything over about 13h40m.
 *
 * A day covers any ordinary stay. Longer than that eventually earns a second
 * check-in, which for a stay spanning more than a day is arguably right.
 */
export const DETECTION_LOOKBACK_MIN = 24 * 60

/**
 * When to treat a stay as already recorded.
 *
 * Pure and exported so the property that matters can be tested: a longer view
 * of the same stay must still cover the check-in written for the shorter one.
 * Matching near the midpoint did not, and per-batch detection turned one night
 * into a column of check-ins.
 */
export function dedupeWindow(v: { start: Date; end: Date }): { gte: Date; lte: Date } {
  return {
    gte: new Date(v.start.getTime() - DEDUPE_MIN * 60_000),
    lte: new Date(v.end.getTime() + DEDUPE_MIN * 60_000),
  }
}

/** Where a visit's check-in is stamped: its middle reads better than its first fix. */
/** The note on an automatic check-in. Parsed back out when a stay grows. */
export function autoNote(minutes: number): string {
  return `Auto-detected · ${minutes} min`
}

export function visitCheckInAt(v: { start: Date; end: Date }): Date {
  return new Date((v.start.getTime() + v.end.getTime()) / 2)
}

export interface DetectedVisit {
  placeId: string
  name: string
  emoji: string
  start: Date
  end: Date
  points: number
}

interface Point { lat: number; lng: number; accuracyM: number | null; trackedAt: Date }
type SavedPlace = PlaceLike & { id: string; name: string; emoji: string }

/**
 * Group a time-ordered run of points into per-place dwells. Pure, so the
 * thresholds above can be tested without a database.
 */
export function detectDwells(points: Point[], places: SavedPlace[]): DetectedVisit[] {
  const visits: DetectedVisit[] = []
  let current: (DetectedVisit & { lastAt: Date }) | null = null

  const flush = () => {
    if (!current) return
    const minutes = (current.end.getTime() - current.start.getTime()) / 60_000
    if (minutes >= MIN_DWELL_MIN) {
      visits.push({
        placeId: current.placeId, name: current.name, emoji: current.emoji,
        start: current.start, end: current.end, points: current.points,
      })
    }
    current = null
  }

  for (const p of points) {
    const match = matchSavedPlace(p.lat, p.lng, places, p.accuracyM ?? 0)
    if (!match) { flush(); continue }

    if (current && current.placeId === match.place.id) {
      const gapMin = (p.trackedAt.getTime() - current.lastAt.getTime()) / 60_000
      if (gapMin <= MAX_GAP_MIN) {
        current.end = p.trackedAt
        current.lastAt = p.trackedAt
        current.points += 1
        continue
      }
      flush()
    } else if (current) {
      flush()
    }

    current = {
      placeId: match.place.id, name: match.place.name, emoji: match.place.emoji,
      start: p.trackedAt, end: p.trackedAt, lastAt: p.trackedAt, points: 1,
    }
  }
  flush()
  return visits
}

/**
 * Detect and record visits in a window. Returns how many check-ins were
 * created; re-running over the same window creates nothing new, so this is
 * safe on a schedule and safe to re-run after an import.
 */
export async function recordPlaceVisits(userId: string, from: Date, to: Date): Promise<{ created: number; detected: number }> {
  const places = await prisma.savedPlace.findMany({
    where: { userId },
    select: { id: true, name: true, emoji: true, lat: true, lng: true, radiusM: true },
  })
  if (places.length === 0) return { created: 0, detected: 0 }

  const points = await prisma.locationPoint.findMany({
    where: { userId, trackedAt: { gte: from, lte: to } },
    select: { lat: true, lng: true, accuracyM: true, trackedAt: true },
    orderBy: { trackedAt: "asc" },
  })
  if (points.length === 0) return { created: 0, detected: 0 }

  const visits = detectDwells(points, places)
  const { created } = await recordVisits(userId, visits)
  return { created, detected: visits.length }
}

/**
 * Write check-ins for visits already detected, wherever they were detected
 * from.
 *
 * Split out because the location API had its own copy of this idea and it was
 * a worse one: any SINGLE point inside a saved place's radius created a
 * check-in, stamped at noon UTC because no real time was to hand. Driving past
 * home logged a visit to it, at 2pm local, whatever time you actually drove
 * past. Two rules for the same event, disagreeing — and the wrong one ran on
 * every page load.
 *
 * Returns the places touched so a caller can say what it tagged.
 */
export async function recordVisits(
  userId: string,
  visits: DetectedVisit[],
): Promise<{ created: number; places: { id: string; name: string; emoji: string; isNew: boolean }[] }> {
  let created = 0
  const touched = new Map<string, { id: string; name: string; emoji: string; isNew: boolean }>()

  for (const v of visits) {
    const at = visitCheckInAt(v)
    const minutes = Math.round((v.end.getTime() - v.start.getTime()) / 60_000)

    // Anywhere inside this stay, not just near its middle — see DEDUPE_MIN.
    const window = dedupeWindow(v)
    const existing = await prisma.checkIn.findFirst({
      where: { userId, savedPlaceId: v.placeId, checkedAt: window },
      select: { id: true, note: true },
    })
    if (existing) {
      touched.set(v.placeId, touched.get(v.placeId) ?? { id: v.placeId, name: v.name, emoji: v.emoji, isNew: false })
      // The check-in is right; its DURATION was frozen at whatever the stay
      // looked like the first time detection ran — twenty minutes in. A night
      // at home read "Auto-detected · 20 min" until morning and then for ever.
      // Its time stays put, so the timeline does not reshuffle underneath you.
      const known = Number(existing.note?.match(/(\d+) min$/)?.[1] ?? -1)
      if (minutes > known) {
        await prisma.checkIn.update({
          where: { id: existing.id },
          data: { note: autoNote(minutes) },
        }).catch(() => null)
      }
      continue
    }

    await prisma.checkIn.create({
      data: {
        userId,
        place: v.name,
        emoji: v.emoji,
        note: autoNote(minutes),
        checkedAt: at,
        isAuto: true,
        savedPlaceId: v.placeId,
      },
    }).catch(() => null)
    created++
    touched.set(v.placeId, { id: v.placeId, name: v.name, emoji: v.emoji, isNew: true })
  }

  return { created, places: [...touched.values()] }
}
