import { describe, it, expect, vi } from "vitest"

// When an experiment is allowed to say "clear".
//
// The verdict used to come from a plain day shuffle: every day of the plan
// thrown into one pool and dealt out again. Days are not exchangeable — HRV,
// sleep and mood carry yesterday inside them — and the correlation engine
// retired that test for exactly this reason. Simulated on null experiments
// with day-to-day autocorrelation of 0.6, it called about one in four of them
// "clear". The simplest case is a body that is just drifting: someone
// recovering from a cold, HRV rising a little every day, runs a one-week-on,
// one-week-off plan. The OFF week is later, so it is higher, and a day shuffle
// calls that a clear effect of the thing they switched on.

const state = vi.hoisted(() => ({
  logs: [] as { date: Date; sleepScore: number | null; hrv: number | null }[],
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn(async () => state.logs) },
    focusSession: { findMany: vi.fn(async () => []) },
    userPreference: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => []),
  },
}))

import { buildSchedule, type ExperimentRow } from "@/lib/experiments"
import { analyseExperiment } from "@/lib/experiments-analysis"

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** A plan that finished yesterday, with a reading for every morning of it. */
function plan(over: Partial<ExperimentRow>, value: (i: number, on: boolean) => number): { e: ExperimentRow; days: { date: string; adhered: boolean }[] } {
  const base: ExperimentRow = {
    id: "exp_verdict", name: "Magnesium before bed", action: "300mg at 21:00",
    outcome: "hrv", blockDays: 7, blocks: 4, washoutDays: 1, startsOn: true,
    startDate: "", status: "running", note: null, ...over,
  }
  const length = base.blockDays * base.blocks
  base.startDate = iso(new Date(Date.now() - (length + 1) * 86400000))
  const schedule = buildSchedule(base)
  // The reading on the morning after day i describes day i.
  state.logs = schedule.map((d, i) => ({
    date: new Date(new Date(d.date + "T00:00:00Z").getTime() + 86400000),
    sleepScore: null,
    hrv: value(i, d.on),
  }))
  return { e: base, days: schedule.map(d => ({ date: d.date, adhered: d.on })) }
}

describe("experiment verdicts", () => {
  it("does not call a steady drift a clear effect", async () => {
    // One week on, one week off; HRV rises 2 ms a day throughout, and the
    // magnesium does nothing at all.
    const { e, days } = plan({ blocks: 2 }, i => 50 + 2 * i)
    const a = await analyseExperiment("u1", e, days)
    expect(a.diff).toBeLessThan(0)
    expect(a.verdict).not.toBe("clear")
  })

  it("will not call it clear before the effect has had a chance to repeat", async () => {
    // A real, large effect — but with one ON block and one OFF block, a
    // change in the person between the two weeks looks exactly the same.
    const { e, days } = plan({ blocks: 2 }, (_i, on) => (on ? 60 : 45))
    const a = await analyseExperiment("u1", e, days)
    expect(a.verdict).not.toBe("clear")
  })

  it("still finds a real effect that repeats across blocks", async () => {
    const { e, days } = plan({}, (i, on) => (on ? 60 : 45) + ((i * 7) % 5) - 2)
    const a = await analyseExperiment("u1", e, days)
    expect(a.pValue!).toBeLessThanOrEqual(0.05)
    expect(a.verdict).toBe("clear")
  })

  it("still finds it when there is no washout to break up the blocks", async () => {
    // With no washout every arm is the same length. Shuffling runs exactly an
    // arm long can then only swap whole arms — six orders for four blocks —
    // and no effect however large gets a p-value under a third.
    const { e, days } = plan({ washoutDays: 0 }, (i, on) => (on ? 60 : 45) + ((i * 7) % 5) - 2)
    const a = await analyseExperiment("u1", e, days)
    expect(a.pValue!).toBeLessThanOrEqual(0.05)
    expect(a.verdict).toBe("clear")
  })
})
