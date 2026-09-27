import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { currentDayStreak } from "@/lib/xp"

// The Stats page read "Water streak 0d · keep going" and "Step goal streak 0d"
// every morning to someone who had hit both goals twelve days running. Both
// streaks started counting at today, and today is never finished at 10:00 —
// 400 ml drunk, 1,200 steps walked — so the first check failed and the loop
// stopped. The step streak also walked the rows it had rather than the
// calendar, so a day with no row at all was stepped over instead of ending
// the run, and both used fixed goals (2 L, 8,000) rather than the ones set in
// Settings.
//
// currentDayStreak already holds the rule the rest of the app uses: today can
// extend a streak but never break one.

describe("goal streaks on the Stats page", () => {
  it("a morning with today unfinished still shows the run that ended yesterday", () => {
    const met = Array.from({ length: 12 }, (_, i) => `2026-09-${String(14 + i).padStart(2, "0")}`)
    expect(currentDayStreak(met, "2026-09-26")).toBe(12)
  })

  it("a day with nothing recorded ends the run rather than being skipped", () => {
    expect(currentDayStreak(["2026-09-22", "2026-09-23", "2026-09-25"], "2026-09-26")).toBe(1)
  })

  const code = readFileSync("src/app/api/stats/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")

  it("the route counts water, steps and sleep with that rule, against the user's goals", () => {
    expect(code).toMatch(/waterStreak\s*=\s*currentDayStreak\(/)
    expect(code).toMatch(/stepStreak\s*=\s*currentDayStreak\(/)
    expect(code).toMatch(/sleepStreak\s*=\s*currentDayStreak\(/)
    expect(code).toMatch(/getGoals\(userId\)/)
    expect(code).not.toMatch(/STEP_GOAL|SLEEP_GOAL_MIN|>=\s*2000\b/)
  })

  it("the page prints the goals the route counted against", () => {
    const page = readFileSync("src/app/dashboard/stats/page.tsx", "utf8")
    expect(page).not.toMatch(/8,000 steps\/day|7h\+ per night/)
  })
})
