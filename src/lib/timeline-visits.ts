import { distanceM } from "@/lib/places"

// Reading *visits* out of a Google Timeline export, and matching them to the
// places a user actually cares about.
//
// A visit is Google's own dwell record — "you were at this place from 14:02 to
// 16:31" — which is a far better signal than raw GPS points for "does my sleep
// suffer after evenings at the café". The health correlations run on these.
//
// Two things used to be hardcoded in the importer component: the six places to
// match against, and the parsing of one export shape. Both live here now, so
// the places can come from the user's own saved places and every export shape
// a Google Takeout produces is understood.

export interface TimelineVisit {
  lat: number
  lng: number
  start: string
  end: string
}

export interface VisitTarget {
  lat: number
  lng: number
  label: string
  emoji: string
}

/** Metres between two coordinates — the one haversine in lib/places. */
export const haversineM = distanceM

/** `"48.1234567°, 17.1234567°"` — how the phone export encodes a coordinate. */
export function parseLatLngString(s: unknown): { lat: number; lng: number } | null {
  if (typeof s !== "string") return null
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const lat = Number(m[1]), lng = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A visit's place, however this export chose to encode it. */
function visitLocation(visit: any): { lat: number; lng: number } | null {
  const c = visit?.topCandidate?.placeLocation
  if (!c) return null
  // Phone export: { latLng: "48.1°, 17.1°" }. Takeout: { latE7, lngE7 }.
  const fromString = parseLatLngString(c.latLng ?? c)
  if (fromString) return fromString
  const lat = Number(c.latE7) / 1e7, lng = Number(c.lngE7) / 1e7
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat, lng }
}

function pushVisit(out: TimelineVisit[], seg: any, visit: any): void {
  const loc = visitLocation(visit)
  if (!loc) return
  const start = seg?.startTime, end = seg?.endTime
  if (typeof start !== "string" || typeof end !== "string") return
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) return
  out.push({ lat: loc.lat, lng: loc.lng, start, end })
}

/**
 * Every visit in a Timeline export, from all the shapes Google ships:
 *  - `semanticSegments[].visit` — the phone's own "Export Timeline data"
 *  - `timelineEdits[].inferredSemanticSegment.segment.visit` — Takeout
 *  - `timelineEdits[].userEditedSemanticSegment.segment.visit` — Takeout,
 *    where the user corrected Google's guess, so it outranks the inferred one.
 */
export function extractVisits(doc: any): TimelineVisit[] {
  const out: TimelineVisit[] = []

  if (Array.isArray(doc?.semanticSegments)) {
    for (const seg of doc.semanticSegments) {
      if (seg?.visit) pushVisit(out, seg, seg.visit)
    }
  }

  if (Array.isArray(doc?.timelineEdits)) {
    for (const e of doc.timelineEdits) {
      for (const holder of [e?.userEditedSemanticSegment, e?.inferredSemanticSegment]) {
        const visit = holder?.segment?.visit
        if (visit) pushVisit(out, holder, visit)
      }
    }
  }

  // One row per (place, start): a Takeout carries the same visit as both an
  // inferred and a user-edited segment, and the two must not count twice.
  const seen = new Set<string>()
  return out.filter(v => {
    const key = `${v.start}_${Math.round(v.lat * 1e5)}_${Math.round(v.lng * 1e5)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
/**
 * The activity segments the importer used to throw away.
 *
 * Every export shape carries them beside the visits: "you travelled from
 * 14:02 to 14:31, and it was IN_BUS" — Google's own classification, matched
 * against transit-line maps, which is how it can distinguish a bus from a car
 * when no phone sensor can. Parsing these gives every imported day real
 * travel modes retroactively, with no new permission and no battery cost.
 */
export interface TimelineActivity {
  start: string
  end: string
  /** Google's type string, e.g. IN_BUS, WALKING — mapped by lib/activity-modes. */
  type: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function pushActivity(out: TimelineActivity[], seg: any, activity: any): void {
  const type = activity?.topCandidate?.type
  if (typeof type !== "string" || !type.trim()) return
  const start = seg?.startTime, end = seg?.endTime
  if (typeof start !== "string" || typeof end !== "string") return
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end))) return
  if (Date.parse(end) <= Date.parse(start)) return
  out.push({ start, end, type: type.trim() })
}

/** Every activity segment, from all the shapes extractVisits reads visits from. */
export function extractActivities(doc: any): TimelineActivity[] {
  const out: TimelineActivity[] = []

  if (Array.isArray(doc?.semanticSegments)) {
    for (const seg of doc.semanticSegments) {
      if (seg?.activity) pushActivity(out, seg, seg.activity)
    }
  }

  if (Array.isArray(doc?.timelineEdits)) {
    for (const e of doc.timelineEdits) {
      for (const holder of [e?.userEditedSemanticSegment, e?.inferredSemanticSegment]) {
        const activity = holder?.segment?.activity
        if (activity) pushActivity(out, holder, activity)
      }
    }
  }

  // Same dedupe rule as the visits: a Takeout carries the same segment as
  // both an inferred and a user-edited entry, and the two must not count
  // twice. The user-edited one comes first in the holder order above, so it
  // is the one that survives.
  const seen = new Set<string>()
  return out.filter(a => {
    const key = `${a.start}_${a.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Group visits by the target they fall within, nearest target winning. Targets
 * with no visits are kept in the summary as zeroes — "you were never there" is
 * an answer, and a silently missing key looks like a broken import.
 */
export function matchVisitsToTargets(
  visits: TimelineVisit[],
  targets: Record<string, VisitTarget>,
  radiusM = 150,
): { visits: Record<string, { start: string; end: string }[]>; summary: Record<string, number> } {
  const grouped: Record<string, { start: string; end: string }[]> = {}
  for (const key of Object.keys(targets)) grouped[key] = []

  for (const v of visits) {
    let bestKey: string | null = null
    let bestDist = Infinity
    for (const [key, t] of Object.entries(targets)) {
      const d = haversineM(v.lat, v.lng, t.lat, t.lng)
      if (d < radiusM && d < bestDist) { bestDist = d; bestKey = key }
    }
    if (bestKey) grouped[bestKey].push({ start: v.start, end: v.end })
  }

  const summary: Record<string, number> = {}
  for (const [k, list] of Object.entries(grouped)) summary[k] = list.length
  return { visits: grouped, summary }
}
