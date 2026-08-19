import { describe, it, expect, vi } from "vitest"

// The schedule and arm-splitting rules are where an N-of-1 experiment is won or
// lost: a washout day counted, or an unanswered day assumed adherent, quietly
// biases the answer the whole exercise exists to produce.

const { healthLogs, TODAY, START } = vi.hoisted(() => {
  // A fixed 28-day window ending today, so "the future doesn't count" is
  // exercised without the test depending on when it runs.
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const today = new Date()
  const start = new Date(today.getTime() - 27 * 86400000)
  const START = iso(start)
  const TODAY = iso(today)

  // Sleep score is 90 the morning after an ON day and 70 after an OFF day —
  // a planted effect the analysis must recover, offset by one day because
  // sleep is a next-day outcome.
  const startsOn = true
  const logs: { date: Date; sleepScore: number | null }[] = []
  for (let i = 0; i < 29; i++) {
    const day = new Date(start.getTime() + i * 86400000)
    const block = Math.floor(i / 7)
    const behaviourWasOn = startsOn ? block % 2 === 0 : block % 2 === 1
    // The reading on day i reflects the behaviour of day i-1.
    const prevBlock = Math.floor((i - 1) / 7)
    const prevOn = i === 0 ? false : (startsOn ? prevBlock % 2 === 0 : prevBlock % 2 === 1)
    void behaviourWasOn
    logs.push({ date: new Date(day.toISOString().slice(0, 10) + "T00:00:00Z"), sleepScore: prevOn ? 90 : 70 })
  }
  return { healthLogs: logs, TODAY, START }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn(async () => healthLogs) },
    focusSession: { findMany: vi.fn(async () => []) },
    userPreference: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => []),
  },
}))

import { buildSchedule, analyseExperiment, currentPhase, totalDays, endDate, type ExperimentRow } from "@/lib/experiments"

const BASE: ExperimentRow = {
  id: "exp1",
  name: "Magnesium before bed",
  action: "Take 300mg magnesium at 21:00",
  outcome: "sleepScore",
  blockDays: 7,
  blocks: 4,
  washoutDays: 1,
  startsOn: true,
  startDate: START,
  status: "running",
  note: null,
}

describe("buildSchedule", () => {
  it("alternates blocks and covers every day exactly once", () => {
    const s = buildSchedule(BASE)
    expect(s).toHaveLength(28)
    expect(new Set(s.map(d => d.date)).size).toBe(28)
    expect(s[0].on).toBe(true)
    expect(s[7].on).toBe(false)
    expect(s[14].on).toBe(true)
    expect(s[21].on).toBe(false)
  })

  it("honours a randomised OFF-first start", () => {
    const s = buildSchedule({ ...BASE, startsOn: false })
    expect(s[0].on).toBe(false)
    expect(s[7].on).toBe(true)
  })

  it("marks washout days after each switch but never in the first block", () => {
    const s = buildSchedule({ ...BASE, washoutDays: 2 })
    expect(s.filter(d => d.block === 1 && d.washout)).toHaveLength(0)
    expect(s.filter(d => d.block === 2 && d.washout)).toHaveLength(2)
    expect(s[7].washout).toBe(true)
    expect(s[9].washout).toBe(false)
  })

  it("reports its own length and end date", () => {
    expect(totalDays(BASE)).toBe(28)
    expect(endDate(BASE)).toBe(TODAY)
  })
})

describe("currentPhase", () => {
  it("locates today inside the plan", () => {
    const p = currentPhase(BASE, START)
    expect(p.dayIndex).toBe(1)
    expect(p.day?.on).toBe(true)
    expect(p.daysLeft).toBe(27)
    expect(p.finished).toBe(false)
  })

  it("knows when the plan is over", () => {
    const p = currentPhase({ ...BASE, startDate: "2020-01-01" }, TODAY)
    expect(p.finished).toBe(true)
    expect(p.daysLeft).toBe(0)
  })
})

describe("analyseExperiment", () => {
  const allDays = () => buildSchedule(BASE).map(d => ({ date: d.date, adhered: d.on }))

  it("recovers a planted effect and reports it as clear", async () => {
    const a = await analyseExperiment("u1", BASE, allDays())
    expect(a.onAvg).toBe(90)
    expect(a.offAvg).toBe(70)
    expect(a.diff).toBe(20)
    expect(a.betterOnOn).toBe(true)
    expect(a.pValue).not.toBeNull()
    expect(a.pValue!).toBeLessThanOrEqual(0.05)
    expect(a.verdict).toBe("clear")
  })

  it("drops washout days from both arms", async () => {
    const a = await analyseExperiment("u1", { ...BASE, washoutDays: 2 }, allDays())
    // 3 switches × 2 days
    expect(a.droppedWashout).toBe(6)
    expect(a.onN + a.offN).toBe(28 - 6)
  })

  it("treats an unanswered ON day as unknown, never as adherent", async () => {
    const days = allDays().filter(d => d.adhered) // only ON days answered
    const withGap = days.slice(1) // first ON day unanswered
    const a = await analyseExperiment("u1", BASE, withGap)
    const full = await analyseExperiment("u1", BASE, days)
    expect(a.onN).toBe(full.onN - 1)
    expect(a.droppedNonAdherent).toBeGreaterThan(0)
  })

  it("excludes an OFF day the user admits doing the thing on", async () => {
    const schedule = buildSchedule(BASE)
    const days = schedule.map(d => ({ date: d.date, adhered: true })) // did it every day
    const a = await analyseExperiment("u1", BASE, days)
    expect(a.offN).toBe(0)
    expect(a.verdict).toBe("not-enough-data")
  })

  it("reports per-block means so a reader can see the effect repeat", async () => {
    const a = await analyseExperiment("u1", BASE, allDays())
    expect(a.blockMeans).toHaveLength(4)
    expect(a.blockMeans.filter(b => b.on).every(b => b.mean === 90)).toBe(true)
    expect(a.blockMeans.filter(b => !b.on).every(b => b.mean === 70)).toBe(true)
  })

  it("refuses to judge when an arm is too thin", async () => {
    const days = allDays().slice(0, 3)
    const a = await analyseExperiment("u1", BASE, days)
    expect(a.verdict).toBe("not-enough-data")
    expect(a.pValue).toBeNull()
  })
})
