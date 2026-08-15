import { describe, it, expect } from "vitest"
import { extractPoints } from "../TimelineImport"

describe("extractPoints", () => {
  it("parses Timeline Edits.json rawSignal positions", () => {
    const doc = {
      timelineEdits: [
        {
          deviceId: "-1",
          rawSignal: {
            signal: {
              position: {
                point: { latE7: 482036071, lngE7: 172074224 },
                accuracyMm: 100000,
                altitudeMeters: 179.8,
                timestamp: "2026-08-07T13:14:25.781Z",
                speedMetersPerSecond: 2.5,
              },
            },
          },
        },
        // wifi scans carry no position and must be skipped
        { deviceId: "-1", rawSignal: { signal: { wifiScan: { deliveryTime: "2026-08-07T13:14:25Z", devices: [] } } } },
      ],
    }
    const pts = extractPoints(doc)
    expect(pts).toHaveLength(1)
    expect(pts[0].lat).toBeCloseTo(48.2036071)
    expect(pts[0].lng).toBeCloseTo(17.2074224)
    expect(pts[0].accuracyM).toBeCloseTo(100)
    expect(pts[0].altitudeM).toBeCloseTo(179.8)
    expect(pts[0].speedKmh).toBeCloseTo(9)
    expect(pts[0].trackedAt).toBe("2026-08-07T13:14:25.781Z")
  })

  it("parses classic Records.json locations", () => {
    const doc = {
      locations: [
        { latitudeE7: 481753792, longitudeE7: 171261066, accuracy: 20, timestamp: "2020-01-05T09:00:00Z" },
        { latitudeE7: 481753792, longitudeE7: 171261066, accuracy: 20, timestampMs: "1578218400000" },
      ],
    }
    const pts = extractPoints(doc)
    expect(pts).toHaveLength(2)
    expect(pts[0].lat).toBeCloseTo(48.1753792)
    expect(pts[0].accuracyM).toBe(20)
    // timestampMs 1578218400000 = 2020-01-05T10:00:00Z
    expect(new Date(pts[1].trackedAt).toISOString()).toBe("2020-01-05T10:00:00.000Z")
  })

  it("parses phone Timeline.json timelinePath, both time encodings", () => {
    const doc = {
      semanticSegments: [
        {
          startTime: "2025-03-01T08:00:00.000Z",
          timelinePath: [
            { point: "48.1828804°, 17.3488704°", time: "2025-03-01T08:05:00.000Z" },
            { point: "48.1830000°, 17.3490000°", durationMinutesOffsetFromStartTime: "10" },
          ],
        },
      ],
    }
    const pts = extractPoints(doc)
    expect(pts).toHaveLength(2)
    expect(pts[0].trackedAt).toBe("2025-03-01T08:05:00.000Z")
    expect(new Date(pts[1].trackedAt).toISOString()).toBe("2025-03-01T08:10:00.000Z")
    expect(pts[1].lat).toBeCloseTo(48.183)
  })

  it("dedupes identical (time, place) pairs and sorts ascending", () => {
    const loc = (ts: string) => ({ latitudeE7: 480000000, longitudeE7: 170000000, timestamp: ts })
    const doc = { locations: [loc("2020-01-02T00:00:00Z"), loc("2020-01-01T00:00:00Z"), loc("2020-01-02T00:00:00Z")] }
    const pts = extractPoints(doc)
    expect(pts).toHaveLength(2)
    expect(Date.parse(pts[0].trackedAt)).toBeLessThan(Date.parse(pts[1].trackedAt))
  })

  it("rejects out-of-range and unparseable entries", () => {
    const doc = {
      locations: [
        { latitudeE7: 991753792, longitudeE7: 171261066, timestamp: "2020-01-05T10:00:00Z" }, // lat > 90
        { latitudeE7: 481753792, longitudeE7: 171261066, timestamp: "not-a-date" },
      ],
    }
    expect(extractPoints(doc)).toHaveLength(0)
  })
})
