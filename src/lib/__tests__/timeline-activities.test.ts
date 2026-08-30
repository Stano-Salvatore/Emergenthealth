import { describe, it, expect } from "vitest"
import { extractActivities } from "@/lib/timeline-visits"

describe("extractActivities", () => {
  it("reads the phone export's semanticSegments", () => {
    const doc = {
      semanticSegments: [
        {
          startTime: "2026-07-15T14:02:00.000+02:00",
          endTime: "2026-07-15T14:31:00.000+02:00",
          activity: { distanceMeters: 6200, topCandidate: { type: "IN_BUS", probability: 0.92 } },
        },
        // a visit segment must not produce an activity
        { startTime: "2026-07-15T15:00:00.000+02:00", endTime: "2026-07-15T16:00:00.000+02:00",
          visit: { topCandidate: { placeLocation: { latLng: "48.1°, 17.1°" } } } },
      ],
    }
    expect(extractActivities(doc)).toEqual([
      { start: "2026-07-15T14:02:00.000+02:00", end: "2026-07-15T14:31:00.000+02:00", type: "IN_BUS" },
    ])
  })

  it("reads Takeout's timelineEdits, the user-edited segment first", () => {
    // The same journey appears twice in a Takeout — Google's inference and,
    // where the user corrected it, their edit. The edited one is walked first
    // so on a same-start collision it is the one the dedupe keeps.
    const doc = {
      timelineEdits: [
        {
          userEditedSemanticSegment: {
            segment: { activity: { topCandidate: { type: "CYCLING" } } },
            startTime: "2026-07-16T08:00:00Z", endTime: "2026-07-16T08:20:00Z",
          },
          inferredSemanticSegment: {
            segment: { activity: { topCandidate: { type: "IN_PASSENGER_VEHICLE" } } },
            startTime: "2026-07-16T08:00:00Z", endTime: "2026-07-16T08:20:00Z",
          },
        },
      ],
    }
    const out = extractActivities(doc)
    expect(out[0].type).toBe("CYCLING")
  })

  it("deduplicates the same segment carried twice", () => {
    const seg = {
      segment: { activity: { topCandidate: { type: "WALKING" } } },
      startTime: "2026-07-16T09:00:00Z", endTime: "2026-07-16T09:20:00Z",
    }
    const doc = { timelineEdits: [{ userEditedSemanticSegment: seg, inferredSemanticSegment: seg }] }
    expect(extractActivities(doc)).toHaveLength(1)
  })

  it("drops segments with unusable times or no type", () => {
    const doc = {
      semanticSegments: [
        { startTime: "not a date", endTime: "2026-07-15T14:31:00Z", activity: { topCandidate: { type: "WALKING" } } },
        // end before start is a claim about time travel, not a journey
        { startTime: "2026-07-15T14:31:00Z", endTime: "2026-07-15T14:02:00Z", activity: { topCandidate: { type: "WALKING" } } },
        { startTime: "2026-07-15T14:02:00Z", endTime: "2026-07-15T14:31:00Z", activity: { topCandidate: {} } },
      ],
    }
    expect(extractActivities(doc)).toEqual([])
  })

  it("has nothing to say about an empty or unrecognised export", () => {
    expect(extractActivities({})).toEqual([])
    expect(extractActivities({ locations: [] })).toEqual([])
  })
})
