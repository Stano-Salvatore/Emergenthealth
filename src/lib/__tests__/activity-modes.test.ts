import { describe, it, expect } from "vitest"
import {
  googleActivityMode, pairTransitions, spanId, MAX_TRANSITION_SPAN_MS, type TransitionEvent,
} from "@/lib/activity-modes"
import { applyKnownModes, type JourneyMove } from "@/lib/day-journeys"

describe("googleActivityMode", () => {
  it("keeps the distinction only Google can make", () => {
    // Bus vs car is the whole point: map-matching against transit lines is
    // the one source that answers it, so IN_BUS must not collapse into drive.
    expect(googleActivityMode("IN_BUS")).toEqual({ mode: "transit", vehicleOnly: false })
    expect(googleActivityMode("IN_PASSENGER_VEHICLE")).toEqual({ mode: "drive", vehicleOnly: false })
    expect(googleActivityMode("IN_TRAM")).toEqual({ mode: "transit", vehicleOnly: false })
    expect(googleActivityMode("IN_SUBWAY")).toEqual({ mode: "train", vehicleOnly: false })
  })

  it("keeps the bus/car question open where Google itself gave up", () => {
    expect(googleActivityMode("IN_VEHICLE")).toEqual({ mode: "drive", vehicleOnly: true })
  })

  it("says nothing about a type we have no word for, rather than guessing", () => {
    expect(googleActivityMode("SKIING")).toBeNull()
    expect(googleActivityMode("IN_FERRY")).toBeNull()
    expect(googleActivityMode("UNKNOWN_ACTIVITY_TYPE")).toBeNull()
  })

  it("is not fussy about case or padding", () => {
    expect(googleActivityMode(" walking ")).toEqual({ mode: "walk", vehicleOnly: false })
  })
})

describe("pairTransitions", () => {
  const T0 = Date.UTC(2026, 7, 30, 8, 0, 0)
  const min = (m: number) => T0 + m * 60_000
  const ev = (type: number, transition: number, atMin: number): TransitionEvent =>
    ({ type, transition, at: min(atMin) })

  it("pairs an ENTER with its EXIT", () => {
    const spans = pairTransitions([ev(7, 0, 0), ev(7, 1, 20)])
    expect(spans).toHaveLength(1)
    expect(spans[0].mode).toBe("walk")
    expect(spans[0].start.getTime()).toBe(min(0))
    expect(spans[0].end.getTime()).toBe(min(20))
  })

  it("closes a span when the next activity begins, even without an EXIT", () => {
    // The OS drops EXIT events; the phone starting to drive is itself the end
    // of the walk.
    const spans = pairTransitions([ev(7, 0, 0), ev(0, 0, 15), ev(0, 1, 45)])
    expect(spans.map(s => [s.mode, s.vehicleOnly])).toEqual([["walk", false], ["drive", true]])
    expect(spans[0].end.getTime()).toBe(min(15))
  })

  it("sorts events that arrived out of order across drain batches", () => {
    const spans = pairTransitions([ev(7, 1, 20), ev(7, 0, 0)])
    expect(spans).toHaveLength(1)
  })

  it("drops a span with a missed EXIT rather than letting it run for ever", () => {
    const spans = pairTransitions([
      { type: 0, transition: 0, at: T0 },
      { type: 0, transition: 1, at: T0 + MAX_TRANSITION_SPAN_MS + 1 },
    ])
    expect(spans).toEqual([])
  })

  it("ignores flutter shorter than a minute", () => {
    expect(pairTransitions([ev(7, 0, 0), { type: 7, transition: 1, at: min(0) + 20_000 }])).toEqual([])
  })

  it("produces nothing from STILL, which the journey's stops already own", () => {
    expect(pairTransitions([ev(3, 0, 0), ev(3, 1, 30)])).toEqual([])
  })
})

describe("applyKnownModes with vehicle-only spans", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 7, 30, 8, m))
  const move = (over: Partial<JourneyMove>): JourneyMove => ({
    kind: "move", start: at(0), end: at(30), minutes: 30, mode: "cycle",
    confidence: "guess", distanceM: 5000, topKmh: 14, avgKmh: 10, pauses: 8, ...over,
  })
  const vehicleSpan = { start: at(0), end: at(30), mode: "drive" as const, vehicleOnly: true }

  it("corrects the tram that speed had called cycling — into transit, still a guess", () => {
    // 14 km/h with a stop every few hundred metres, and the sensors say
    // vehicle: that is a tram in traffic, not a bicycle and not a car.
    const [out] = applyKnownModes([move({})], [vehicleSpan]) as [JourneyMove]
    expect(out.mode).toBe("transit")
    expect(out.confidence).toBe("guess")
  })

  it("leaves a move already labelled as a vehicle alone", () => {
    const [out] = applyKnownModes([move({ mode: "transit" })], [vehicleSpan]) as [JourneyMove]
    expect(out.mode).toBe("transit")
    expect(out.confidence).toBe("guess")
  })

  it("lets a definite span outrank a vehicle-only one, whatever the overlap", () => {
    const [out] = applyKnownModes(
      [move({})],
      [vehicleSpan, { start: at(0), end: at(20), mode: "transit" as const }],
    ) as [JourneyMove]
    expect(out.mode).toBe("transit")
    expect(out.confidence).toBe("known")
  })
})

describe("spanId", () => {
  it("is deterministic, so a re-import is a no-op", () => {
    expect(spanId("user_abcdefgh", "timeline", 123, "walk"))
      .toBe(spanId("user_abcdefgh", "timeline", 123, "walk"))
  })
})
