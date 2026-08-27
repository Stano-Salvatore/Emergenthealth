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
  let created = 0

  for (const v of visits) {
    const at = visitCheckInAt(v)

    // Anywhere inside this stay, not just near its middle — see DEDUPE_MIN.
    const window = dedupeWindow(v)
    const existing = await prisma.checkIn.findFirst({
      where: { userId, savedPlaceId: v.placeId, checkedAt: window },
      select: { id: true },
    })
    if (existing) continue

    await prisma.checkIn.create({
      data: {
        userId,
        place: v.name,
        emoji: v.emoji,
        note: `Auto-detected · ${Math.round((v.end.getTime() - v.start.getTime()) / 60_000)} min`,
        checkedAt: at,
        isAuto: true,
        savedPlaceId: v.placeId,
      },
    }).catch(() => null)
    created++
  }

  return { created, detected: visits.length }
}
