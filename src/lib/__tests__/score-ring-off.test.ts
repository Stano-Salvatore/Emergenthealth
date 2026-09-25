import { describe, it, expect, vi, beforeEach } from "vitest"

// The daily score died with the ring. On a ring-off night sleep, recovery and
// steps all read absent, coverage fell under the floor, and the home screen's
// one number went blank — on exactly the days the phone's own night estimate
// sat in its table. The loader now fills TODAY's sleep duration from the
// phone when the ring has nothing, labels the source so the card can say so,
// and never blends phone estimates into the ring's history baselines —
// phone-sleep.ts's own rule.

const db = vi.hoisted(() => ({
  health: [] as unknown[],
  nights: [] as { minutes: number; day: string }[],
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: async () => db.health },
    moodLog: { findMany: async () => [] },
    $queryRaw: async () => [],
  },
}))
vi.mock("@/lib/user-timezone", () => ({ getUserTimezone: async () => "Europe/Bratislava" }))
vi.mock("@/lib/phone-sleep", () => ({ phoneNights: async () => db.nights }))

import { loadDailyScore } from "@/lib/daily-score-load"

const DAY = "2026-09-25"
const ringHistory = () => {
  const rows: unknown[] = []
  for (let i = 1; i <= 14; i++) {
    const d = new Date(Date.UTC(2026, 8, 25 - i))
    rows.push({
      date: d, sleepScore: 78, sleepDuration: 430, deepSleep: 60,
      readinessScore: 72, hrv: 55, restingHR: 54, steps: 9000, activeMinutes: 40, stressHigh: null,
    })
  }
  return rows
}

describe("the score survives a ring-off night", () => {
  beforeEach(() => { db.health = ringHistory(); db.nights = [] })

  it("fills today's sleep from the phone and says so", async () => {
    db.nights = [{ minutes: 390, day: DAY }]
    const out = await loadDailyScore("u1", DAY)
    expect(out.sleepSource).toBe("phone")
    const sleep = out.components.find(c => c.key === "sleep")
    const duration = sleep?.parts.find(p => p.label === "Duration")
    expect(duration?.value).toBe("6.5h")
  })

  it("the ring wins where it speaks — the phone never overrides it", async () => {
    db.health = [...ringHistory(), {
      date: new Date(DAY + "T00:00:00Z"), sleepScore: 80, sleepDuration: 480, deepSleep: 70,
      readinessScore: 75, hrv: 58, restingHR: 53, steps: 4000, activeMinutes: 20, stressHigh: null,
    }]
    db.nights = [{ minutes: 300, day: DAY }]
    const out = await loadDailyScore("u1", DAY)
    expect(out.sleepSource).toBe("ring")
    const duration = out.components.find(c => c.key === "sleep")?.parts.find(p => p.label === "Duration")
    expect(duration?.value).toBe("8h")
  })

  it("no ring and no phone stays honestly absent", async () => {
    const out = await loadDailyScore("u1", DAY)
    expect(out.sleepSource).toBeNull()
    // A metric with no reading today produces no part at all — absent, not zero.
    const duration = out.components.find(c => c.key === "sleep")?.parts.find(p => p.label === "Duration")
    expect(duration).toBeUndefined()
  })
})
