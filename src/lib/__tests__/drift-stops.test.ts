import { describe, it, expect } from "vitest"
import { detectStops, type TimedPoint } from "@/lib/day-stops"

// "Home till 05:27, then a 262m walk to somewhere unnamed for 55m, back by
// 06:32" — narrated to a user who was asleep the whole time. The fixes had
// drifted a few hundred metres on wifi/cell accuracy, clustered there long
// enough to pass the stop thresholds, and the journey builder walked them
// over and back. The discriminator is the accuracy the phone itself reported:
// two stops whose distance apart is inside their combined uncertainty are the
// same place, and saying otherwise is narrating error bars.

const HOME = { lat: 48.15, lon: 17.11 }
/** ~0.0009° lat ≈ 100 m. */
const latOff = (m: number) => m / 111_320

const pt = (minute: number, lat: number, lon: number, accuracyM?: number): TimedPoint => ({
  lat, lon, accuracyM, time: new Date(Date.UTC(2026, 8, 25, 2, 0) + minute * 60_000),
})

/** A night at home: fixes every 5 minutes, good accuracy. */
const homeStretch = (fromMin: number, toMin: number, acc = 20): TimedPoint[] => {
  const out: TimedPoint[] = []
  for (let m = fromMin; m <= toMin; m += 5) out.push(pt(m, HOME.lat, HOME.lon, acc))
  return out
}

describe("stops indistinguishable from their neighbour merge into it", () => {
  it("a drifted cluster 260m out on 400m accuracy is the same stay", () => {
    const drifted: TimedPoint[] = []
    for (let m = 125; m <= 180; m += 5) drifted.push(pt(m, HOME.lat + latOff(260), HOME.lon, 400))
    const stops = detectStops([...homeStretch(0, 120), ...drifted, ...homeStretch(185, 300)])
    expect(stops.length, "the drifted cluster survived as its own stop").toBe(1)
    // The merged stay spans the whole night, drift included.
    expect(stops[0].minutes).toBeGreaterThanOrEqual(295)
  })

  it("a real visit 260m away on good accuracy stays its own stop", () => {
    const shop: TimedPoint[] = []
    for (let m = 125; m <= 180; m += 5) shop.push(pt(m, HOME.lat + latOff(260), HOME.lon, 15))
    const stops = detectStops([...homeStretch(0, 120), ...shop, ...homeStretch(185, 300)])
    expect(stops.length, "a genuine nearby visit was eaten by the drift merge").toBe(3)
  })

  it("unknown accuracy never merges: absence of an error bar is not a small one", () => {
    const near: TimedPoint[] = []
    for (let m = 125; m <= 180; m += 5) near.push(pt(m, HOME.lat + latOff(260), HOME.lon))
    const stops = detectStops([
      ...homeStretch(0, 120, undefined as unknown as number),
      ...near,
      ...homeStretch(185, 300, undefined as unknown as number),
    ].map(p => ({ ...p, accuracyM: undefined })))
    expect(stops.length).toBe(3)
  })
})
