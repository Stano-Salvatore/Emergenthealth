import { describe, it, expect } from "vitest"
import { dedupeWindow, detectDwells, MAX_GAP_MIN, MIN_DWELL_MIN, visitCheckInAt } from "../place-visits"

const CAFE = { id: "cafe", name: "Kaviareň Vták", emoji: "☕", lat: 48.1490416, lng: 17.1171726, radiusM: 150 }
const HOME = { id: "home", name: "Home", emoji: "🏠", lat: 48.175421976678, lng: 17.126068557003457, radiusM: 150 }
const PLACES = [CAFE, HOME]

const T0 = Date.parse("2026-08-07T09:00:00Z")
const at = (place: { lat: number; lng: number }, minutes: number, accuracyM: number | null = 20) => ({
  lat: place.lat, lng: place.lng, accuracyM, trackedAt: new Date(T0 + minutes * 60_000),
})

describe("detectDwells", () => {
  it("records a dwell that meets the minimum", () => {
    const points = [at(CAFE, 0), at(CAFE, 15), at(CAFE, 30), at(CAFE, 45)]
    const visits = detectDwells(points, PLACES)
    expect(visits).toHaveLength(1)
    expect(visits[0].name).toBe("Kaviareň Vták")
    expect(visits[0].points).toBe(4)
    expect((visits[0].end.getTime() - visits[0].start.getTime()) / 60_000).toBe(45)
  })

  it("ignores passing through", () => {
    // Two fixes a few minutes apart — the tram going past, not a coffee.
    expect(detectDwells([at(CAFE, 0), at(CAFE, MIN_DWELL_MIN - 5)], PLACES)).toHaveLength(0)
  })

  it("ignores points that match no saved place", () => {
    expect(detectDwells([
      { lat: 50, lng: 20, accuracyM: 20, trackedAt: new Date(T0) },
      { lat: 50, lng: 20, accuracyM: 20, trackedAt: new Date(T0 + 60 * 60_000) },
    ], PLACES)).toHaveLength(0)
  })

  it("splits one place into two visits across a long gap", () => {
    // Morning at home, out all day, home again — two visits, not one 12h blob.
    const points = [
      at(HOME, 0), at(HOME, 30),
      at(HOME, 30 + MAX_GAP_MIN + 60), at(HOME, 30 + MAX_GAP_MIN + 120),
    ]
    const visits = detectDwells(points, PLACES)
    expect(visits).toHaveLength(2)
    expect(visits[0].start.getTime()).toBeLessThan(visits[1].start.getTime())
  })

  it("closes a dwell when the user moves to another place", () => {
    const points = [at(HOME, 0), at(HOME, 30), at(CAFE, 60), at(CAFE, 120)]
    const visits = detectDwells(points, PLACES)
    expect(visits.map(v => v.name)).toEqual(["Home", "Kaviareň Vták"])
  })

  it("keeps a dwell whose sparse points still span the minimum", () => {
    // OwnTracks throttles hard when still: two fixes an hour apart is a visit.
    const visits = detectDwells([at(HOME, 0), at(HOME, 60)], PLACES)
    expect(visits).toHaveLength(1)
  })

  it("does not let a wildly inaccurate fix invent a visit", () => {
    // 5 km away with 10 km of claimed accuracy — matchSavedPlace caps the
    // slack it will grant, so this must not count as being at the café.
    const far = { lat: CAFE.lat + 0.05, lng: CAFE.lng }
    expect(detectDwells([at(far, 0, 10_000), at(far, 60, 10_000)], PLACES)).toHaveLength(0)
  })
})

// ── Re-detecting a stay that is still happening ────────────────────────────
// Background tracking runs detection on every upload batch, so the same stay is
// examined again and again while it grows. Matching a previous check-in near
// the visit's MIDPOINT failed here: the midpoint advances as the stay lengthens
// and eventually walks out of its own window, writing a second check-in for a
// night nobody left. These pin the property that stopped that.


const clock = (hhmm: string) => new Date(`2026-08-27T${hhmm}:00Z`)
const covers = (w: { gte: Date; lte: Date }, d: Date) => d >= w.gte && d <= w.lte

describe("dedupeWindow", () => {
  it("still covers the first check-in once the stay has grown", () => {
    const first = { start: clock("22:00"), end: clock("22:30") }
    const stamped = visitCheckInAt(first)

    // The same night, seen again after two, six and ten more hours.
    for (const end of ["00:30", "04:30", "08:30"]) {
      const grown = { start: clock("22:00"), end: new Date(clock(end).getTime() + 86_400_000) }
      expect(covers(dedupeWindow(grown), stamped)).toBe(true)
    }
  })

  it("covers its own check-in, whatever the length", () => {
    const v = { start: clock("09:00"), end: clock("17:00") }
    expect(covers(dedupeWindow(v), visitCheckInAt(v))).toBe(true)
  })

  // The test above holds `start` fixed. The real caller does not: it re-detects
  // from a rolling look-back, so a too-short window slides the detected start
  // forward and the check-in ages out of range anyway. This walks the actual
  // loop — batch, detect over [latest - lookback, latest], dedupe — and counts.
  it("writes one check-in for a long stay, batch after batch", () => {
    const HOUR = 3_600_000
    const arrived = clock("22:00").getTime()
    const written: Date[] = []

    // A ten-hour night, re-detected every five minutes as the points arrive.
    for (let now = arrived; now <= arrived + 10 * HOUR; now += 5 * 60_000) {
      const windowStart = Math.max(arrived, now - MAX_GAP_MIN * 60_000 * 16) // 24h look-back
      const seen = { start: new Date(windowStart), end: new Date(now) }
      if (new Date(now).getTime() - arrived < MIN_DWELL_MIN * 60_000) continue
      const w = dedupeWindow(seen)
      if (written.some(d => d >= w.gte && d <= w.lte)) continue
      written.push(visitCheckInAt(seen))
    }
    expect(written).toHaveLength(1)
  })

  it("does not swallow a genuinely separate later visit", () => {
    // Two stays can only be separate if more than MAX_GAP_MIN (90) apart, or
    // detectDwells would have kept them as one.
    const morning = { start: clock("08:00"), end: clock("10:00") }
    const evening = { start: clock("18:00"), end: clock("20:00") }
    expect(covers(dedupeWindow(evening), visitCheckInAt(morning))).toBe(false)
  })
})
