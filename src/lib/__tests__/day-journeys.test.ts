import { describe, it, expect } from "vitest"
import {
  applyKnownModes,
  buildJourney,
  inferMode,
  moveStats,
  stravaMode,
  weightedPercentileKmh,
  type JourneyMove,
  type JourneyStay,
} from "@/lib/day-journeys"
import { detectStops, type TimedPoint } from "@/lib/day-stops"

// A patch of Bratislava, so the coordinates look like the ones this runs on.
const LAT = 48.1486
const LNG = 17.1077
const M_PER_DEG_LNG = 111_320 * Math.cos((LAT * Math.PI) / 180)

const at = (min: number) => new Date(Date.UTC(2026, 7, 28, 8, 0, 0) + min * 60_000)

/** A straight line east at a constant speed, sampled every `everySec`. */
function line(opts: {
  fromMin: number
  minutes: number
  kmh: number
  everySec?: number
  startM?: number
}): TimedPoint[] {
  const { fromMin, minutes, kmh, everySec = 60, startM = 0 } = opts
  const out: TimedPoint[] = []
  const steps = Math.round((minutes * 60) / everySec)
  for (let i = 0; i <= steps; i++) {
    const sec = i * everySec
    const metres = startM + (kmh / 3.6) * sec
    out.push({
      lat: LAT,
      lon: LNG + metres / M_PER_DEG_LNG,
      time: new Date(at(fromMin).getTime() + sec * 1000),
    })
  }
  return out
}

/** Sitting still at one spot, with the small jitter a real fix always has. */
function still(opts: { fromMin: number; minutes: number; everySec?: number; atM?: number }): TimedPoint[] {
  const { fromMin, minutes, everySec = 300, atM = 0 } = opts
  const out: TimedPoint[] = []
  const steps = Math.round((minutes * 60) / everySec)
  for (let i = 0; i <= steps; i++) {
    out.push({
      lat: LAT + (i % 2 === 0 ? 0.00004 : -0.00004),
      lon: LNG + atM / M_PER_DEG_LNG + (i % 3 === 0 ? 0.00005 : -0.00003),
      time: new Date(at(fromMin).getTime() + i * everySec * 1000),
    })
  }
  return out
}

describe("weightedPercentileKmh", () => {
  it("weights by how long a leg lasted, not how many legs there were", () => {
    // Nine seconds of 30 km/h in nine one-second legs, then an hour at 5 km/h.
    // By count the fast legs are the overwhelming majority; by time they are
    // nothing, and the pace this held was 5.
    const legs = [
      ...Array.from({ length: 9 }, () => ({ metres: 8.3, seconds: 1, kmh: 30 })),
      { metres: 5000, seconds: 3600, kmh: 5 },
    ]
    expect(weightedPercentileKmh(legs, 0.85)).toBe(5)
  })

  it("is not moved by a single outlier leg", () => {
    const legs = [
      ...Array.from({ length: 20 }, () => ({ metres: 100, seconds: 60, kmh: 6 })),
      { metres: 5000, seconds: 60, kmh: 300 },
    ]
    expect(weightedPercentileKmh(legs, 0.85)).toBe(6)
  })

  it("is zero with nothing to measure", () => {
    expect(weightedPercentileKmh([], 0.85)).toBe(0)
  })
})

describe("moveStats", () => {
  it("measures a straight walk", () => {
    // 20 minutes at 5 km/h is 1667 m.
    const s = moveStats(line({ fromMin: 0, minutes: 20, kmh: 5 }))
    expect(s.minutes).toBe(20)
    expect(s.distanceM).toBeGreaterThan(1600)
    expect(s.distanceM).toBeLessThan(1720)
    expect(s.topKmh).toBeCloseTo(5, 1)
    expect(s.avgKmh).toBeCloseTo(5, 1)
  })

  it("does not count a stationary phone's jitter as distance", () => {
    const s = moveStats(still({ fromMin: 0, minutes: 60, everySec: 60 }))
    expect(s.distanceM).toBe(0)
    // The hour still happened, though — dropping the time as well as the
    // distance is what used to make a slow move report a fast average.
    expect(s.minutes).toBe(60)
    expect(s.avgKmh).toBe(0)
  })
})

describe("inferMode", () => {
  const modeOf = (points: TimedPoint[]) => inferMode(moveStats(points))

  it("calls a 5 km/h stretch walking", () => {
    expect(modeOf(line({ fromMin: 0, minutes: 20, kmh: 5 }))).toEqual({
      mode: "walk",
      confidence: "likely",
    })
  })

  it("calls 16 km/h cycling", () => {
    expect(modeOf(line({ fromMin: 0, minutes: 20, kmh: 16 })).mode).toBe("cycle")
  })

  it("calls 60 km/h a drive", () => {
    expect(modeOf(line({ fromMin: 0, minutes: 20, kmh: 60 })).mode).toBe("drive")
  })

  it("calls 160 km/h over a long way a train", () => {
    const m = modeOf(line({ fromMin: 0, minutes: 60, kmh: 160 }))
    expect(m.mode).toBe("train")
    expect(m.confidence).toBe("likely")
  })

  it("needs distance as well as speed before it says flight", () => {
    // Fast but only four kilometres: a bad fix, not a departure.
    expect(modeOf(line({ fromMin: 0, minutes: 1, kmh: 240 })).mode).not.toBe("flight")
    expect(modeOf(line({ fromMin: 0, minutes: 120, kmh: 700 })).mode).toBe("flight")
  })

  it("hedges when the fixes are too sparse to see the shape", () => {
    const sparse = line({ fromMin: 0, minutes: 40, kmh: 5, everySec: 15 * 60 })
    expect(modeOf(sparse)).toEqual({ mode: "walk", confidence: "guess" })
  })

  it("hedges when the speed sits on a boundary", () => {
    // 6.6 km/h is walking, but only just — a slightly different route would
    // have put it the other side, so it should not be asserted.
    expect(modeOf(line({ fromMin: 0, minutes: 20, kmh: 6.6 }))).toEqual({
      mode: "walk",
      confidence: "guess",
    })
  })

  it("declines to narrate a stretch too short to be a journey", () => {
    expect(modeOf(line({ fromMin: 0, minutes: 1, kmh: 4 }))).toEqual({
      mode: "unknown",
      confidence: "guess",
    })
  })

  describe("a bus and a car on the same road", () => {
    // Six kilometres at 30 km/h either way. The only difference is that one of
    // them keeps stopping for passengers.
    const roadRun = (withStops: boolean): TimedPoint[] => {
      const out: TimedPoint[] = []
      let metres = 0
      let sec = 0
      const push = () => out.push({
        lat: LAT,
        lon: LNG + metres / M_PER_DEG_LNG,
        time: new Date(at(0).getTime() + sec * 1000),
      })
      push()
      for (let block = 0; block < 12; block++) {
        // 500 m of driving at 30 km/h = 60 s, sampled every 20 s.
        for (let i = 0; i < 3; i++) {
          metres += (30 / 3.6) * 20
          sec += 20
          push()
        }
        if (withStops) {
          // 40 s at the kerb, still reporting.
          sec += 40
          push()
        }
      }
      return out
    }

    it("leans to a bus when it stops every few hundred metres", () => {
      const m = modeOf(roadRun(true))
      expect(m.mode).toBe("transit")
      // Still only a lean: nothing in a GPS trace proves it.
      expect(m.confidence).toBe("guess")
    })

    it("leans to driving when it does not", () => {
      expect(modeOf(roadRun(false)).mode).toBe("drive")
    })
  })
})

describe("buildJourney", () => {
  it("alternates stays and moves in the order they happened", () => {
    const points = [
      ...still({ fromMin: 0, minutes: 60, atM: 0 }),          // home
      ...line({ fromMin: 62, minutes: 15, kmh: 5, startM: 0 }), // walk east
      ...still({ fromMin: 80, minutes: 45, atM: 1250 }),       // café
    ]
    const journey = buildJourney(points, detectStops(points))

    expect(journey.map(s => s.kind)).toEqual(["stay", "move", "stay"])
    const [home, walk, cafe] = journey as [JourneyStay, JourneyMove, JourneyStay]
    // A stay ends where the track leaves its radius, not at the last fix that
    // sat perfectly still: the first minute or so of a 5 km/h walk is still
    // within 120 m of the sofa. So home runs slightly past the hour it was
    // built from, and the walk starts correspondingly late.
    expect(home.minutes).toBeGreaterThanOrEqual(60)
    expect(home.minutes).toBeLessThan(66)
    expect(walk.mode).toBe("walk")
    // The full walk is 1250 m; the move covers what is left after each end is
    // claimed by the stay it starts and finishes inside.
    expect(walk.distanceM).toBeGreaterThan(1000)
    expect(walk.distanceM).toBeLessThan(1300)
    expect(cafe.minutes).toBeGreaterThanOrEqual(45)
    // The move fills the hole exactly: no minute belongs to two segments and
    // none belongs to neither.
    expect(walk.start.getTime()).toBe(home.end.getTime())
    expect(walk.end.getTime()).toBe(cafe.start.getTime())
  })

  it("calls a silence a gap rather than inventing a journey across it", () => {
    const points = [
      ...still({ fromMin: 0, minutes: 30, atM: 0 }),
      // Nothing for three hours, then a fix eight kilometres away.
      ...still({ fromMin: 210, minutes: 30, atM: 8000 }),
    ]
    const journey = buildJourney(points, detectStops(points))

    expect(journey.map(s => s.kind)).toEqual(["stay", "gap", "stay"])
    const gap = journey[1]
    expect(gap.minutes).toBe(180)
  })

  it("does not narrate GPS drift between two halves of one stay", () => {
    // Same spot before and after, with a wander of a few metres in between.
    const points = [
      ...still({ fromMin: 0, minutes: 30, atM: 0 }),
      { lat: LAT + 0.0004, lon: LNG + 60 / M_PER_DEG_LNG, time: at(33) },
      ...still({ fromMin: 36, minutes: 30, atM: 0 }),
    ]
    const journey = buildJourney(points, detectStops(points))
    expect(journey.some(s => s.kind === "move")).toBe(false)
  })

  it("describes a day that never stopped anywhere as one move", () => {
    const points = line({ fromMin: 0, minutes: 40, kmh: 12 })
    const journey = buildJourney(points, detectStops(points))
    expect(journey.map(s => s.kind)).toEqual(["move"])
  })

  it("has nothing to say about a day with no points", () => {
    expect(buildJourney([], [])).toEqual([])
  })

  it("reads a whole day end to end", () => {
    const points = [
      ...still({ fromMin: 0, minutes: 90, atM: 0 }),             // 08:00 home
      ...line({ fromMin: 92, minutes: 14, kmh: 5, startM: 0 }),  // walk
      ...still({ fromMin: 108, minutes: 75, atM: 1170 }),        // café
      ...line({ fromMin: 185, minutes: 12, kmh: 30, startM: 1170, everySec: 30 }), // bus
      ...still({ fromMin: 199, minutes: 120, atM: 7170 }),       // bar
    ]
    const journey = buildJourney(points, detectStops(points))

    expect(journey.map(s => s.kind)).toEqual(["stay", "move", "stay", "move", "stay"])
    const moves = journey.filter((s): s is JourneyMove => s.kind === "move")
    expect(moves[0].mode).toBe("walk")
    // 30 km/h with no passenger stops in the trace reads as a road vehicle;
    // which one it was is not knowable from this, and the label says so.
    expect(["drive", "transit"]).toContain(moves[1].mode)
    expect(moves[1].confidence).toBe("guess")

    // Each stay runs a few minutes past the still period it was built from —
    // see the radius note above — so these are the built durations, loosely.
    const stays = journey.filter((s): s is JourneyStay => s.kind === "stay")
    expect(stays).toHaveLength(3)
    for (const [i, built] of [90, 75, 120].entries()) {
      expect(stays[i].minutes).toBeGreaterThanOrEqual(built)
      expect(stays[i].minutes).toBeLessThan(built + 8)
    }
  })

  it("tiles the day: no minute in two segments, none in none", () => {
    const points = [
      ...still({ fromMin: 0, minutes: 90, atM: 0 }),
      ...line({ fromMin: 92, minutes: 14, kmh: 5, startM: 0 }),
      ...still({ fromMin: 108, minutes: 75, atM: 1170 }),
      ...line({ fromMin: 185, minutes: 12, kmh: 30, startM: 1170, everySec: 30 }),
      ...still({ fromMin: 199, minutes: 120, atM: 7170 }),
    ]
    const journey = buildJourney(points, detectStops(points))

    // Segments abut exactly, and together they span the tracked day. This is
    // the property the whole view rests on: a reader should be able to run a
    // finger down it and account for every minute.
    for (let i = 1; i < journey.length; i++) {
      expect(journey[i].start.getTime()).toBe(journey[i - 1].end.getTime())
    }
    expect(journey[0].start.getTime()).toBe(points[0].time.getTime())
    expect(journey[journey.length - 1].end.getTime()).toBe(points[points.length - 1].time.getTime())
  })
})

describe("applyKnownModes", () => {
  const move = (fromMin: number, toMin: number): JourneyMove => ({
    kind: "move",
    start: at(fromMin),
    end: at(toMin),
    minutes: toMin - fromMin,
    mode: "drive",
    confidence: "guess",
    distanceM: 6000,
    topKmh: 30,
    avgKmh: 24,
    pauses: 0,
  })

  it("replaces a guess with what Strava recorded", () => {
    const out = applyKnownModes([move(0, 40)], [{ start: at(0), end: at(40), mode: "run" }])
    expect(out[0]).toMatchObject({ mode: "run", confidence: "known" })
  })

  it("leaves a move alone when the activity barely touches it", () => {
    // A run that ends two minutes into an hour's drive says nothing about it.
    const out = applyKnownModes([move(0, 60)], [{ start: at(-30), end: at(2), mode: "run" }])
    expect(out[0]).toMatchObject({ mode: "drive", confidence: "guess" })
  })

  it("prefers the activity that covers most of the move", () => {
    const out = applyKnownModes([move(0, 60)], [
      { start: at(0), end: at(35), mode: "walk" },
      { start: at(0), end: at(55), mode: "cycle" },
    ])
    expect(out[0]).toMatchObject({ mode: "cycle", confidence: "known" })
  })

  it("never relabels a stay", () => {
    const stay: JourneyStay = {
      kind: "stay", start: at(0), end: at(60), minutes: 60, lat: LAT, lon: LNG, points: 12,
    }
    expect(applyKnownModes([stay], [{ start: at(0), end: at(60), mode: "run" }])[0]).toBe(stay)
  })
})

describe("stravaMode", () => {
  it("maps the types Strava actually sends", () => {
    expect(stravaMode("Run")).toBe("run")
    expect(stravaMode("Hike")).toBe("walk")
    expect(stravaMode("EBikeRide")).toBe("cycle")
  })

  it("says nothing about a type it does not know, rather than guessing", () => {
    expect(stravaMode("Kitesurf")).toBeNull()
    expect(stravaMode("WeightTraining")).toBeNull()
  })
})
