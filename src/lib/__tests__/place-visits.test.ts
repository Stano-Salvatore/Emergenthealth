import { describe, it, expect } from "vitest"
import { detectDwells, MIN_DWELL_MIN, MAX_GAP_MIN } from "../place-visits"

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
