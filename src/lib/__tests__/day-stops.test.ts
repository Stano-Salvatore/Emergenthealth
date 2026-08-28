import { describe, it, expect } from "vitest"
import { detectStops, summariseTrack, STOP_MIN_MIN } from "../day-stops"
import { trackToSvgPath } from "../gpx"

const CAFE = { lat: 48.1490416, lon: 17.1171726 }
const HOME = { lat: 48.175421976678, lon: 17.126068557003457 }
const T0 = Date.parse("2026-08-28T09:00:00Z")
const at = (p: { lat: number; lon: number }, min: number, jitterM = 0) => ({
  // Jitter along latitude, where a metre is a metre everywhere.
  lat: p.lat + jitterM / 111_320,
  lon: p.lon,
  time: new Date(T0 + min * 60_000),
})

describe("detectStops", () => {
  it("finds a stay and reports its middle, not its first fix", () => {
    const stops = detectStops([
      at(CAFE, 0, -40), at(CAFE, 10, 0), at(CAFE, 20, 0), at(CAFE, 30, 40),
    ])
    expect(stops).toHaveLength(1)
    expect(stops[0].minutes).toBe(30)
    expect(stops[0].points).toBe(4)
    // Mean of -40, 0, 0, +40 metres is the anchor itself.
    expect(stops[0].lat).toBeCloseTo(CAFE.lat, 6)
  })

  it("ignores passing through", () => {
    expect(detectStops([at(CAFE, 0), at(CAFE, STOP_MIN_MIN - 2)])).toHaveLength(0)
  })

  it("keeps two stays at different places apart, in order", () => {
    const stops = detectStops([
      at(HOME, 0), at(HOME, 25),
      at(CAFE, 40), at(CAFE, 70),
    ])
    expect(stops).toHaveLength(2)
    expect(stops[0].lat).toBeCloseTo(HOME.lat, 4)
    expect(stops[1].lat).toBeCloseTo(CAFE.lat, 4)
    expect(stops[0].start.getTime()).toBeLessThan(stops[1].start.getTime())
  })

  it("does not bridge a silence into one long stay", () => {
    // Phone off for two hours. Reporting 0-180 as one stop would claim
    // three hours nobody observed.
    const stops = detectStops([at(CAFE, 0), at(CAFE, 15), at(CAFE, 135), at(CAFE, 150)])
    expect(stops).toHaveLength(2)
    expect(stops[0].minutes).toBe(15)
    expect(stops[1].minutes).toBe(15)
  })

  it("calls a steady walk no stop at all", () => {
    // 100 m every five minutes for a kilometre. Each fix is within a radius of
    // the last, so anchoring on the PREVIOUS point would grow one stop across
    // the whole walk. Anchored on the running centre, no cluster ever lasts
    // long enough to count — which is right: walking is not stopping.
    const walk = Array.from({ length: 11 }, (_, i) => at(CAFE, i * 5, i * 100))
    expect(detectStops(walk)).toHaveLength(0)
  })

  it("breaks a slow drift into separate stops rather than one long one", () => {
    // The same kilometre, but dawdled — twenty minutes between fixes, so each
    // cluster does pass the threshold. What must not happen is a single stop
    // claiming the whole distance.
    const dawdle = Array.from({ length: 11 }, (_, i) => at(CAFE, i * 20, i * 100))
    const stops = detectStops(dawdle)
    expect(stops.length).toBeGreaterThan(1)
    const wholeSpan = (dawdle.at(-1)!.time.getTime() - dawdle[0].time.getTime()) / 60_000
    expect(Math.max(...stops.map(s => s.minutes))).toBeLessThan(wholeSpan)
  })

  it("says nothing about a day with one fix", () => {
    expect(detectStops([at(CAFE, 0)])).toHaveLength(0)
  })
})

describe("trackToSvgPath", () => {
  it("draws a square detour square", () => {
    // 300 m north then 300 m east, at Bratislava's latitude.
    const dLat = 300 / 111_320
    const dLon = 300 / (111_320 * Math.cos((48.15 * Math.PI) / 180))
    const p = trackToSvgPath(
      [
        { lat: 48.15, lon: 17.11 },
        { lat: 48.15 + dLat, lon: 17.11 },
        { lat: 48.15 + dLat, lon: 17.11 + dLon },
      ],
      800, 400, 24,
    )!
    const north = Math.abs(p.toY(48.15 + dLat) - p.toY(48.15))
    const east = Math.abs(p.toX(17.11 + dLon) - p.toX(17.11))
    // Equal ground distances must draw equal lengths. Scaling each axis to
    // fill the box made these differ by the box's own aspect ratio.
    expect(east).toBeCloseTo(north, 1)
  })

  it("does not blow a still day up into a scribble", () => {
    // Ten metres of jitter across a whole afternoon.
    const pts = Array.from({ length: 20 }, (_, i) => ({
      lat: 48.15 + (i % 2 === 0 ? 10 : -10) / 111_320,
      lon: 17.11,
    }))
    const p = trackToSvgPath(pts, 800, 400, 24)!
    const spread = Math.abs(p.toY(pts[0].lat) - p.toY(pts[1].lat))
    // 20 m inside a floored 250 m span across ~350 usable px.
    expect(spread).toBeLessThan(40)
  })

  it("has nothing to draw for a single point", () => {
    expect(trackToSvgPath([{ lat: 48.15, lon: 17.11 }], 800, 400, 24)).toBeNull()
  })
})

describe("summariseTrack", () => {
  const at2 = (lat: number, lon: number, min: number) => ({ lat, lon, time: new Date(T0 + min * 60_000) })

  it("does not count standing still as walking", () => {
    // Four hours in one room, a fix every fifteen minutes, ±14 m of jitter —
    // the shape of a working afternoon under the app's own tracking. Summing
    // every hop reported hundreds of metres walked across the carpet.
    const still = Array.from({ length: 17 }, (_, i) =>
      at2(CAFE.lat + (i % 2 === 0 ? 14 : -14) / 111_320, CAFE.lon, i * 15))
    const s = summariseTrack(still, detectStops(still))
    expect(s.distanceKm).toBe(0)
    expect(s.movingMin).toBe(0)
    expect(s.maxSpeedKmh).toBe(0)
  })

  it("never reports an average faster than the fastest leg", () => {
    // The invariant that caught the bug: distance was summed over every hop
    // while moving time was the day minus its stops, so a mostly-still day
    // averaged 3.9 km/h with a quickest leg of 2.6.
    const day = [
      at2(48.15, 17.11, 0), at2(48.15, 17.11, 30),      // stayed
      at2(48.155, 17.11, 40), at2(48.16, 17.12, 55),    // moved
      at2(48.16, 17.12, 120),                            // stayed
    ]
    const s = summariseTrack(day, detectStops(day))
    const avg = s.movingMin > 0 ? s.distanceKm / (s.movingMin / 60) : 0
    expect(avg).toBeLessThanOrEqual(s.maxSpeedKmh + 1e-9)
  })

  it("drops an impossible leg instead of clamping it", () => {
    // One fix lands in another country for a second. Clamping to a ceiling
    // would present that as the day's top speed.
    const s = summariseTrack([at2(48.15, 17.11, 0), at2(52.5, 13.4, 1), at2(48.15, 17.11, 2)])
    expect(s.maxSpeedKmh).toBe(0)
    expect(s.distanceKm).toBe(0)
  })
})
