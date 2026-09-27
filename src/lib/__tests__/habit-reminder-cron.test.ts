import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { streakAtRiskTonight, type HabitSchedule } from "@/lib/habit-schedule"

// The 21:00 "🔥 Streak at risk!" push picked any habit not done today with
// more than two completions in the last thirty days. So "Meditate", done on
// 1–3 September and never since — streak 0 — was "at risk" every night for
// a month; and a 3×-a-week "Gym" done Monday to Wednesday was "at risk" every
// night from Thursday, though its week was already won. It now asks the same
// streak maths the Habits page shows.

const daily: HabitSchedule = { scheduleDays: [], timesPerWeek: null }
const monWedFri: HabitSchedule = { scheduleDays: [1, 3, 5], timesPerWeek: null }
const threeAWeek: HabitSchedule = { scheduleDays: [], timesPerWeek: 3 }
const set = (...days: string[]) => new Set(days)
const none = set()

describe("streakAtRiskTonight", () => {
  it("is quiet for a habit with no streak to lose", () => {
    // Sun 27 Sept; last done 1–3 Sept.
    expect(streakAtRiskTonight(daily, set("2026-09-01", "2026-09-02", "2026-09-03"), none, "2026-09-27")).toBe(false)
  })

  it("warns about a live daily run", () => {
    expect(streakAtRiskTonight(daily, set("2026-09-25", "2026-09-26"), none, "2026-09-27")).toBe(true)
  })

  it("does not call a single day a streak", () => {
    expect(streakAtRiskTonight(daily, set("2026-09-26"), none, "2026-09-27")).toBe(false)
  })

  it("is quiet once today is done, skipped or on vacation", () => {
    const run = set("2026-09-25", "2026-09-26")
    expect(streakAtRiskTonight(daily, new Set([...run, "2026-09-27"]), none, "2026-09-27")).toBe(false)
    expect(streakAtRiskTonight(daily, run, set("2026-09-27"), "2026-09-27")).toBe(false)
    expect(streakAtRiskTonight(daily, run, none, "2026-09-27", d => d === "2026-09-27")).toBe(false)
  })

  it("is quiet on a weekday habit's off-day, and warns on its due day", () => {
    const run = set("2026-09-21", "2026-09-23", "2026-09-25") // Mon, Wed, Fri
    expect(streakAtRiskTonight(monWedFri, run, none, "2026-09-29")).toBe(false) // Tue
    expect(streakAtRiskTonight(monWedFri, run, none, "2026-09-28")).toBe(true)  // Mon
  })

  it("is quiet for a weekly habit whose week is already won", () => {
    // Mon–Wed done, target 3: Thursday to Sunday nothing is at stake.
    const week = set("2026-09-21", "2026-09-22", "2026-09-23", "2026-09-14", "2026-09-15", "2026-09-16")
    for (const day of ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"]) {
      expect(streakAtRiskTonight(threeAWeek, week, none, day), day).toBe(false)
    }
  })

  it("warns a weekly habit only on the last night one more completion would save", () => {
    const lastWeekMet = ["2026-09-14", "2026-09-15", "2026-09-16"]
    const twoThisWeek = set(...lastWeekMet, "2026-09-21", "2026-09-22")
    expect(streakAtRiskTonight(threeAWeek, twoThisWeek, none, "2026-09-27")).toBe(true)  // Sunday, one short
    expect(streakAtRiskTonight(threeAWeek, twoThisWeek, none, "2026-09-24")).toBe(false) // Thursday, days left
    const oneThisWeek = set(...lastWeekMet, "2026-09-21")
    expect(streakAtRiskTonight(threeAWeek, oneThisWeek, none, "2026-09-27")).toBe(false) // already lost
  })
})

describe("the habit-reminders cron", () => {
  const src = readFileSync("src/app/api/cron/habit-reminders/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("decides streak risk with the shared streak maths, in the user's own day", () => {
    expect(src).toMatch(/streakAtRiskTonight\(/)
    // CURRENT_DATE is the database server's day, not the user's.
    expect(src).not.toMatch(/CURRENT_DATE/)
  })

  // Browser push: a reminder that pushed at 09:00 and was then snoozed to
  // 10:00, or re-timed to 20:00, never pushed again — "reminder:<id>" was
  // already in today's sent log. The time is part of what was sent.
  it("keys the sent log on the time as well as the id", () => {
    expect(src).not.toMatch(/`habit:\$\{h\.id\}`/)
    expect(src).not.toMatch(/`reminder:\$\{r\.id\}`/)
    expect(src).toMatch(/`habit:\$\{h\.id\}:\$\{h\.reminderTime\}`/)
    expect(src).toMatch(/`reminder:\$\{r\.id\}:\$\{r\.reminderTime\}`/)
  })

  // The "every 10 minutes" GitHub schedule has been observed running every
  // 2–5 hours. A 150-minute catch-up window let a 17:00 reminder fall into
  // the gap between a 16:34 run and a 19:58 one and never be sent.
  it("catches up across the gaps GitHub's scheduler actually leaves", () => {
    const m = /const CATCHUP_MINUTES = (\d+)/.exec(src)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(330)
  })
})
