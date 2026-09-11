import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { whyNightMissing, RING_OFF_MAX_STEPS } from "@/lib/sleep-quality"

// "Three nights of the seven have no data" was true and useless. It covered a
// ring in a drawer and a ring worn all day that filed nothing, which are not
// the same week — the second is usually the answer to why the week looks short.
//
// On this account the nine nights without a row split 13759 / 12742 / 10166 /
// 7506 / 7330 steps against 487 / 421 / 148 / 55, with nothing in between.

describe("whyNightMissing", () => {
  it("calls a day that never moved a ring that was not on", () => {
    for (const steps of [0, 55, 148, 421, 487]) {
      expect(whyNightMissing(steps)).toBe("ring-off")
    }
  })

  it("calls a normal day of walking a night that simply did not register", () => {
    for (const steps of [7330, 7506, 10166, 12742, 13759]) {
      expect(whyNightMissing(steps)).toBe("awake")
    }
  })

  it("refuses to guess with no step count", () => {
    expect(whyNightMissing(null)).toBe("unknown")
    expect(whyNightMissing(undefined)).toBe("unknown")
  })

  it("keeps the threshold inside the gap the data actually shows", () => {
    // Anything between 487 and 7330 separates this account's nine nights. A
    // threshold that drifts outside that gap starts making claims the steps
    // do not support.
    expect(RING_OFF_MAX_STEPS).toBeGreaterThan(487)
    expect(RING_OFF_MAX_STEPS).toBeLessThan(7330)
  })
})

describe("the weekly answer says which kind of gap it is", () => {
  const run = readFileSync("src/lib/quick-answer-run.ts", "utf8")

  it("reads the step count it needs to tell them apart", () => {
    expect(run).toContain("whyNightMissing")
    expect(run).toMatch(/steps: true/)
  })

  it("names both cases, and neither as a certainty", () => {
    // It is an inference off a step count, so it says "looks like" — the app's
    // standing rule is honest status text, and a hedge is part of honest.
    expect(run).toContain("the ring looks like it was off")
    expect(run).toContain("still recorded no sleep")
  })

  it("still refuses to count tonight as a gap", () => {
    expect(run).toMatch(/const pending =/)
    expect(run).toContain("isn't in yet")
  })
})
