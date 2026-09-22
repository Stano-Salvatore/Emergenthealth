import { describe, it, expect } from "vitest"
import { sessionLoad, trainingLoad, suggestSession } from "@/lib/training-load"

const TODAY = "2026-09-09"
function d(daysAgo: number) {
  return new Date(Date.parse(TODAY + "T00:00:00Z") - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

describe("sessionLoad", () => {
  it("multiplies minutes by effort and assumes 5 when unscored", () => {
    expect(sessionLoad(60, 7)).toBe(420)
    expect(sessionLoad(30, null)).toBe(150)
    expect(sessionLoad(30, 99)).toBe(150)
  })
})

describe("trainingLoad", () => {
  it("is resting with nothing logged", () => {
    const l = trainingLoad([], TODAY)
    expect(l.trend).toBe("resting")
    expect(l.ratio).toBeNull()
  })

  // This function only ever sees Strava activities — loadSessionsForUser
  // reads that table and nothing else. The resting sentence used to say "No
  // sessions in the last four weeks", full stop, and the daily brief pastes
  // it straight into the model's prompt. Somebody who had walked 12,000 steps
  // the day before was told they had not trained in a month: true of the
  // table, false of them, and read by the person as the app not paying
  // attention.
  it("says WHOSE sessions it cannot see when there are none", () => {
    const summary = trainingLoad([], TODAY).summary
    expect(
      /strava/i.test(summary),
      `The resting summary is "${summary}". It has to name Strava: this function cannot see walking, ` +
        "steps or anything logged elsewhere, and unqualified it tells an active person they have been still.",
    ).toBe(true)
    // And it must not claim the silence covers everything.
    expect(summary).toMatch(/walk|step/i)
  })

  it("calls a steady four weeks steady", () => {
    const sessions = []
    for (let i = 0; i < 28; i += 2) sessions.push({ day: d(i), minutes: 45, rpe: 6 })
    const l = trainingLoad(sessions, TODAY)
    expect(l.trend).toBe("steady")
    expect(l.sessions7d).toBe(4)
    expect(l.ratio!).toBeGreaterThan(0.8)
    expect(l.ratio!).toBeLessThanOrEqual(1.3)
  })

  it("flags a spike when this week dwarfs the base", () => {
    const sessions = [{ day: d(20), minutes: 30, rpe: 4 }]
    for (let i = 0; i < 6; i++) sessions.push({ day: d(i), minutes: 60, rpe: 8 })
    const l = trainingLoad(sessions, TODAY)
    expect(l.trend).toBe("spiking")
    expect(l.summary).toMatch(/Sharp jump/)
  })

  it("ignores sessions in the future or older than four weeks", () => {
    const l = trainingLoad([{ day: d(-1), minutes: 60, rpe: 9 }, { day: d(40), minutes: 60, rpe: 9 }], TODAY)
    expect(l.sessions28d).toBe(0)
  })
})

describe("suggestSession", () => {
  const steady = trainingLoad([{ day: d(3), minutes: 40, rpe: 5 }, { day: d(10), minutes: 40, rpe: 5 }, { day: d(17), minutes: 40, rpe: 5 }, { day: d(24), minutes: 40, rpe: 5 }], TODAY)
  const recent = [68, 70, 72, 71, 69, 73, 70]

  it("rests on a spiking week whatever readiness says", () => {
    const spiking = trainingLoad(Array.from({ length: 6 }, (_, i) => ({ day: d(i), minutes: 90, rpe: 9 })), TODAY)
    expect(suggestSession(90, recent, spiking).suggestion).toBe("rest")
  })

  it("scales the ask to the user's own median readiness", () => {
    expect(suggestSession(80, recent, steady).suggestion).toBe("hard")
    expect(suggestSession(71, recent, steady).suggestion).toBe("moderate")
    expect(suggestSession(64, recent, steady).suggestion).toBe("easy")
    expect(suggestSession(50, recent, steady).suggestion).toBe("rest")
  })

  it("defaults to moderate without a score", () => {
    expect(suggestSession(null, recent, steady).suggestion).toBe("moderate")
  })
})
