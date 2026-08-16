import { describe, it, expect } from "vitest"
import { extractVisits, matchVisitsToTargets, parseLatLngString, type VisitTarget } from "../timeline-visits"
import { buildTargets } from "@/components/settings/TimelineImporter"

const HOME: VisitTarget = { lat: 48.175421976678, lng: 17.126068557003457, label: "Home", emoji: "🏠" }

describe("parseLatLngString", () => {
  it("reads the phone export's degree encoding", () => {
    expect(parseLatLngString("48.1754219°, 17.1260685°")).toEqual({ lat: 48.1754219, lng: 17.1260685 })
    expect(parseLatLngString("-33.8688°, 151.2093°")).toEqual({ lat: -33.8688, lng: 151.2093 })
  })
  it("rejects nonsense and out-of-range values", () => {
    expect(parseLatLngString("not a coordinate")).toBeNull()
    expect(parseLatLngString(42)).toBeNull()
    expect(parseLatLngString("99.5°, 17.1°")).toBeNull()
  })
})

describe("extractVisits", () => {
  it("reads phone-export semanticSegments visits", () => {
    const doc = {
      semanticSegments: [
        {
          startTime: "2026-08-07T07:37:22Z",
          endTime: "2026-08-07T09:14:32Z",
          visit: { topCandidate: { placeLocation: { latLng: "48.1754219°, 17.1260685°" } } },
        },
        // an activity segment carries no visit
        { startTime: "2026-08-07T09:14:32Z", endTime: "2026-08-07T09:38:32Z", activity: {} },
      ],
    }
    const visits = extractVisits(doc)
    expect(visits).toHaveLength(1)
    expect(visits[0].lat).toBeCloseTo(48.1754219)
    expect(visits[0].start).toBe("2026-08-07T07:37:22Z")
    expect(visits[0].end).toBe("2026-08-07T09:14:32Z")
  })

  it("reads Takeout visits and prefers the user's correction over the inference", () => {
    const doc = {
      timelineEdits: [
        {
          inferredSemanticSegment: {
            startTime: "2026-08-07T07:37:22Z",
            endTime: "2026-08-07T09:14:32Z",
            segment: { visit: { topCandidate: { placeLocation: { latE7: 483955340, lngE7: 173090072 } } } },
          },
          userEditedSemanticSegment: {
            startTime: "2026-08-07T07:37:22Z",
            endTime: "2026-08-07T09:14:32Z",
            segment: { visit: { topCandidate: { placeLocation: { latE7: 483955340, lngE7: 173090072 } } } },
          },
        },
      ],
    }
    // Same place and start in both sections — counted once, not twice.
    expect(extractVisits(doc)).toHaveLength(1)
  })

  it("skips visits with unusable times or places", () => {
    const doc = {
      semanticSegments: [
        { startTime: "nope", endTime: "2026-08-07T09:14:32Z", visit: { topCandidate: { placeLocation: { latLng: "48.1°, 17.1°" } } } },
        { startTime: "2026-08-07T07:37:22Z", endTime: "2026-08-07T09:14:32Z", visit: { topCandidate: {} } },
      ],
    }
    expect(extractVisits(doc)).toHaveLength(0)
  })
})

describe("matchVisitsToTargets", () => {
  const at = (lat: number, lng: number) => ({ lat, lng, start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z" })

  it("assigns a visit to the nearest target within the radius", () => {
    const targets = {
      home: HOME,
      cafe: { lat: 48.1490416, lng: 17.1171726, label: "Café", emoji: "☕" },
    }
    const res = matchVisitsToTargets([at(HOME.lat + 0.0002, HOME.lng)], targets, 150)
    expect(res.summary).toEqual({ home: 1, cafe: 0 })
  })

  it("drops visits outside every radius", () => {
    const res = matchVisitsToTargets([at(50, 20)], { home: HOME }, 150)
    expect(res.summary.home).toBe(0)
    expect(res.visits.home).toEqual([])
  })
})

describe("buildTargets", () => {
  const place = (over: Partial<{ id: string; name: string; emoji: string; lat: number; lng: number; radiusM: number }> = {}) => ({
    id: "abc", name: "Gym", emoji: "🏋️", lat: 48.2, lng: 17.2, radiusM: 150, ...over,
  })

  it("keeps the legacy six when nothing is saved, so an old import still works", () => {
    const targets = buildTargets([])
    expect(Object.keys(targets)).toHaveLength(6)
    expect(targets.home.label).toBe("Home")
  })

  it("adds saved places alongside the legacy targets", () => {
    const targets = buildTargets([place()])
    expect(targets["place_abc"]).toMatchObject({ label: "Gym", emoji: "🏋️" })
    expect(Object.keys(targets)).toHaveLength(7)
  })

  it("lets a saved place supersede the legacy target it covers", () => {
    // Saving your home shouldn't produce two competing "home" series.
    const targets = buildTargets([place({ id: "h", name: "My home", lat: HOME.lat, lng: HOME.lng })])
    expect(targets.home).toBeUndefined()
    expect(targets["place_h"].label).toBe("My home")
    expect(Object.keys(targets)).toHaveLength(6)
  })
})
