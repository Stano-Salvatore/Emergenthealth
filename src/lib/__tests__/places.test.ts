import { describe, it, expect } from "vitest"
import { distanceM, matchSavedPlace } from "@/lib/places"

// Kaviareň Vták, Bratislava-ish coordinates for a realistic fixture
const VTAK = { id: "1", name: "Kaviareň Vták", emoji: "☕", lat: 48.1447, lng: 17.1077, radiusM: 75 }
const HOME = { id: "2", name: "Home", emoji: "🏡", lat: 48.16, lng: 17.06, radiusM: 100 }

describe("distanceM", () => {
  it("measures real-world distances sanely", () => {
    // ~100 m of latitude ≈ 0.0009°
    expect(distanceM(48.1447, 17.1077, 48.1456, 17.1077)).toBeCloseTo(100, -1)
    expect(distanceM(48.1447, 17.1077, 48.1447, 17.1077)).toBe(0)
  })
})

describe("matchSavedPlace", () => {
  it("recognizes standing inside the café", () => {
    const m = matchSavedPlace(48.1448, 17.1078, [HOME, VTAK])
    expect(m?.place.name).toBe("Kaviareň Vták")
    expect(m!.distanceM).toBeLessThan(75)
  })

  it("returns null when nowhere familiar", () => {
    expect(matchSavedPlace(48.2, 17.2, [HOME, VTAK])).toBeNull()
  })

  it("picks the nearest when radii overlap", () => {
    const a = { ...VTAK, id: "a", radiusM: 500 }
    const b = { ...VTAK, id: "b", name: "Next door", lat: 48.1449, radiusM: 500 }
    const m = matchSavedPlace(48.14492, 17.1077, [a, b])
    expect(m?.place.id).toBe("b")
  })

  it("gives GPS accuracy some slack, but never more than 100 m", () => {
    // ~120 m away from a 75 m-radius place
    const lat = 48.1447 + 0.00108
    expect(matchSavedPlace(lat, 17.1077, [VTAK], 0)).toBeNull()
    expect(matchSavedPlace(lat, 17.1077, [VTAK], 60)).not.toBeNull()  // 75+60 ≥ 120
    const farLat = 48.1447 + 0.0018 // ~200 m
    expect(matchSavedPlace(farLat, 17.1077, [VTAK], 500)).toBeNull()  // slack capped at 100
  })
})
