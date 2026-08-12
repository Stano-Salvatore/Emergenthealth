import { describe, it, expect, vi } from "vitest"

// Synthetic 40-day history with planted effects, served through a mocked
// Prisma client — the engine should rediscover every planted correlation.
//
// Even-index days: late dinner (21:30), high protein/calories/sugar, 2.5L water.
// Odd-index days:  early dinner (18:00), light eating, 1L water, magnesium.
// Next-day recordings: energy 5 after even days / 2 after odd days;
// sleep score 65 after late-meal days / 90 after early dinners (= magnesium days).

const { DAYS, healthLogs, checkIns, foodLogs, waterLogs, ouraTags } = vi.hoisted(() => {
  const DAYS = 40
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 1; i--) {
    const d = new Date(now.getTime() - i * 86400000)
    dates.push(d.toISOString().slice(0, 10))
  }
  const isEven = (i: number) => i % 2 === 0

  return {
    DAYS,
    healthLogs: dates.map((ds, i) => ({
      date: new Date(ds + "T00:00:00Z"),
      // day i records the night after day i-1's dinner
      sleepScore: i === 0 ? null : isEven(i - 1) ? 65 : 90,
      sleepDuration: null, readinessScore: null, restingHR: null,
      stressHigh: null, hrv: i === 0 ? null : isEven(i - 1) ? 40 : 62,
      steps: null, activityScore: null,
    })),
    checkIns: dates.map((ds, i) => ({
      date: ds,
      energy: i === 0 ? 3 : isEven(i - 1) ? 5 : 2,
      mood: 3,
    })),
    foodLogs: dates.map((ds, i) => ({
      loggedAt: new Date(ds + (isEven(i) ? "T21:30:00Z" : "T18:00:00Z")),
      calories: isEven(i) ? 2200 : 1400,
      proteinG: isEven(i) ? 110 : 40,
      sugarG: isEven(i) ? 85 : 20,
    })),
    waterLogs: dates.map((ds, i) => ({
      loggedAt: new Date(ds + "T12:00:00Z"),
      amountMl: isEven(i) ? 2500 : 1000,
    })),
    ouraTags: dates.filter((_, i) => !isEven(i)).map(ds => ({
      day: ds, tagName: "Magnesium", text: null,
    })),
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn().mockResolvedValue(healthLogs) },
    habitCompletion: { findMany: vi.fn().mockResolvedValue([]) },
    weatherLog: { findMany: vi.fn().mockResolvedValue([]) },
    screenTimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    deviceCalendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
    intakeLog: { findMany: vi.fn().mockResolvedValue(waterLogs) },
    foodLog: { findMany: vi.fn().mockResolvedValue(foodLogs) },
    ouraTag: { findMany: vi.fn().mockResolvedValue(ouraTags) },
    userPreference: { findUnique: vi.fn().mockResolvedValue({ value: "UTC" }) },
    // Tagged-template queries: route by the table named in the SQL.
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const sql = strings.join("?")
      if (sql.includes("MorningCheckIn")) return Promise.resolve(checkIns)
      return Promise.resolve([])
    }),
  },
}))

import { computeCorrelations } from "@/lib/correlations"

describe("computeCorrelations — food, hydration, supplements", () => {
  it("rediscovers every planted effect with the right direction", async () => {
    const { insights, totalDays } = await computeCorrelations("user_test", 60)
    expect(totalDays).toBe(DAYS)
    const byId = Object.fromEntries(insights.map(i => [i.id, i]))

    // Late meals → worse sleep that night
    const late = byId["food_late_meal_sleep"]
    expect(late).toBeDefined()
    expect(late.highGroupAvg).toBeLessThan(late.lowGroupAvg) // 65 vs 90
    expect(late.confident).toBe(true)

    // High-protein days → better next-day energy
    const protein = byId["food_protein_energy"]
    expect(protein).toBeDefined()
    expect(protein.highGroupAvg).toBeGreaterThan(protein.lowGroupAvg) // 5 vs 2

    // Calories and sugar comparisons exist (same planted split)
    expect(byId["food_calories_sleep"]).toBeDefined()
    expect(byId["food_sugar_energy"]).toBeDefined()

    // 2L+ water days → better next-day energy
    const water = byId["water_energy"]
    expect(water).toBeDefined()
    expect(water.highGroupAvg).toBeGreaterThan(water.lowGroupAvg)

    // Magnesium days → better sleep and HRV the following morning
    const mgSleep = byId["supplement_magnesium_sleep"]
    expect(mgSleep).toBeDefined()
    expect(mgSleep.highGroupAvg).toBeGreaterThan(mgSleep.lowGroupAvg) // 90 vs 65
    expect(mgSleep.category).toBe("supplements")
    const mgHrv = byId["supplement_magnesium_hrv"]
    expect(mgHrv).toBeDefined()
    expect(mgHrv.highGroupAvg).toBeGreaterThan(mgHrv.lowGroupAvg) // 62 vs 40
  })

  it("stays silent on food insights when there are too few food days", async () => {
    const { prisma } = await import("@/lib/prisma")
    ;(prisma.foodLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(foodLogs.slice(0, 5))
    const { insights } = await computeCorrelations("user_test", 60)
    expect(insights.find(i => i.id === "food_late_meal_sleep")).toBeUndefined()
    expect(insights.find(i => i.id === "food_protein_energy")).toBeUndefined()
  })
})
