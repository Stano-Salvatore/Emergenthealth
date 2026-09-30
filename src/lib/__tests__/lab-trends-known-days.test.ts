import { describe, it, expect, vi, beforeEach } from "vitest"

// HealthLog is written by the Oura cron whether or not anyone opens the app,
// so "a HealthLog row exists" does not mean drinks and workouts were being
// recorded that day. Reading the days before drink logging began as 0 g put
// "alcohol 7 g a day, up from 0 g a day" next to a GGT result, and a Strava
// account connected mid-interval read as "exercise up from 0 min".

type Range = { gte?: Date }
const db = {
  labs: [] as { marker: string; value: number; unit: string; date: Date; referenceMin: number | null; referenceMax: number | null }[],
  healthDays: [] as string[],
  intake: [] as { type: string; amountMl: number; note: string | null; loggedAt: Date }[],
  strava: [] as { day: string; movingTimeSec: number }[],
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    labResult: { findMany: async () => db.labs },
    $queryRaw: async () => [],
    healthLog: {
      findMany: async ({ where }: { where: { date?: Range } }) =>
        db.healthDays
          .map(d => ({ date: new Date(d + "T00:00:00Z"), sleepDuration: null, steps: null }))
          .filter(r => !where.date?.gte || r.date >= where.date.gte),
    },
    stravaActivity: {
      findMany: async ({ where }: { where: { day?: { gte?: string } } }) =>
        db.strava.filter(a => !where.day?.gte || a.day >= where.day.gte),
      findFirst: async () => [...db.strava].sort((a, b) => a.day.localeCompare(b.day))[0] ?? null,
    },
    bodyMeasurement: { findMany: async () => [] },
    intakeLog: {
      findMany: async ({ where }: { where: { loggedAt?: Range; type?: { in: string[] } } }) =>
        db.intake.filter(i =>
          (!where.loggedAt?.gte || i.loggedAt >= where.loggedAt.gte) && (!where.type || where.type.in.includes(i.type))),
      findFirst: async () =>
        [...db.intake].sort((a, b) => a.loggedAt.getTime() - b.loggedAt.getTime())[0] ?? null,
    },
  },
}))
vi.mock("@/lib/user-timezone", () => ({ getUserTimezone: async () => "Europe/Bratislava" }))

import { loadLabTrends } from "@/lib/lab-trends-load"

function days(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = new Date(from + "T00:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

const ggt = (value: number, date: string) =>
  ({ marker: "GGT", value, unit: "ukat/l", date: new Date(date + "T00:00:00Z"), referenceMin: 0.14, referenceMax: 0.84 })

/** Something in the intake diary every day from `from`, and a beer every other day. */
function diaryFrom(from: string, to: string) {
  return days(from, to).flatMap((d, i) => [
    { type: "water", amountMl: 500, note: null, loggedAt: new Date(d + "T08:00:00Z") },
    ...(i % 2 === 0 ? [{ type: "beer", amountMl: 500, note: null, loggedAt: new Date(d + "T18:00:00Z") }] : []),
  ])
}

beforeEach(() => {
  db.labs = [ggt(0.45, "2026-01-15"), ggt(0.95, "2026-09-10")]
  db.healthDays = days("2025-01-01", "2026-09-10")
  db.intake = []
  db.strava = []
})

describe("behaviour context between two draws — a day the ring synced is not a day drinks were logged", () => {
  it("does not read the months before drink logging began as sober", async () => {
    db.intake = diaryFrom("2026-04-01", "2026-09-10")
    const { trends } = await loadLabTrends("u1")
    const t = trends.find(x => x.marker === "GGT")!
    expect(t.behaviours.map(b => b.key)).not.toContain("alcohol")
    expect(t.summary).not.toMatch(/up from 0 g/)
  })

  it("does not read the months before Strava was connected as sedentary", async () => {
    db.strava = days("2026-04-01", "2026-09-10").map(day => ({ day, movingTimeSec: 45 * 60 }))
    const { trends } = await loadLabTrends("u1")
    const t = trends.find(x => x.marker === "GGT")!
    expect(t.behaviours.map(b => b.key)).not.toContain("workout")
    expect(t.summary).not.toMatch(/up from 0 min/)
  })

  it("still compares when drinks were being logged through both windows", async () => {
    // Diary open from well before the earlier window; the drinking started
    // between the draws. A real 0 g, so a real comparison.
    db.intake = diaryFrom("2025-01-01", "2026-09-10").filter(i => i.type === "water" || i.loggedAt >= new Date("2026-01-15"))
    const { trends } = await loadLabTrends("u1")
    const t = trends.find(x => x.marker === "GGT")!
    const alcohol = t.behaviours.find(b => b.key === "alcohol")
    expect(alcohol?.before).toBe(0)
    expect(alcohol?.direction).toBe("up")
  })
})
