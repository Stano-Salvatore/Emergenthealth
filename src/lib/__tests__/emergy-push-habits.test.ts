import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { habitsTallyToday, type HabitSchedule } from "@/lib/habit-schedule"

// Emergy's afternoon scream counted every habit the user owns against every
// completion today. Three Mon/Wed/Fri habits and one daily one, the daily one
// done, on a Tuesday: "1 OF 4 HABITS. IT IS 3PM. WE ARE BOTH SUFFERING 😭" —
// sticky, and repeated in chat — on a day when everything due was done. A
// habit skipped with a reason counted as failed too. It now counts the way
// the Today card does.

const h = (schedule: Partial<HabitSchedule>, done: string[] = [], skipped: string[] = []) => ({
  schedule: { scheduleDays: [], timesPerWeek: null, ...schedule },
  completionDays: new Set(done),
  skipDays: new Set(skipped),
})

const TUE = "2026-09-22"

describe("habitsTallyToday", () => {
  it("leaves out habits the schedule does not ask for today", () => {
    const tally = habitsTallyToday([
      h({ scheduleDays: [1, 3, 5] }), h({ scheduleDays: [1, 3, 5] }), h({ scheduleDays: [1, 3, 5] }),
      h({}, [TUE]),
    ], TUE)
    expect(tally).toEqual({ due: 1, done: 1 })
  })

  it("counts a skip with a reason as dealt with", () => {
    expect(habitsTallyToday([h({}, [], [TUE]), h({})], TUE)).toEqual({ due: 2, done: 1 })
  })

  it("leaves out a weekly habit whose target is already met this week", () => {
    const tally = habitsTallyToday([h({ timesPerWeek: 2 }, ["2026-09-21", "2026-09-20"])], TUE)
    // Sunday the 20th is last week (weeks run Mon–Sun), so only one counts: still due.
    expect(tally).toEqual({ due: 1, done: 0 })
    expect(habitsTallyToday([h({ timesPerWeek: 1 }, ["2026-09-21"])], TUE)).toEqual({ due: 0, done: 0 })
  })

  it("still counts a habit done today on an off-day", () => {
    expect(habitsTallyToday([h({ scheduleDays: [1] }, [TUE])], TUE)).toEqual({ due: 1, done: 1 })
  })
})

describe("the emergy-push cron", () => {
  const raw = readFileSync("src/app/api/cron/emergy-push/route.ts", "utf8")
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("tallies habits with the shared helper", () => {
    expect(src).toMatch(/habitsTallyToday\(/)
  })

  // The route only ran if a tick landed inside the user's 15:00 hour, and the
  // GitHub schedule it rides on has left 3–5 hour gaps — whole afternoons
  // passed with no nudge at all. A window, with the per-day sent marker
  // stopping repeats, lets any later tick (or the daily Vercel cron) catch it.
  it("fires anywhere in an afternoon window, not only inside one hour", () => {
    expect(src).not.toMatch(/!==\s*NUDGE_HOUR/)
    expect(src).toMatch(/NUDGE_UNTIL_HOUR/)
  })

  it("does not claim it is 3pm when it may not be", () => {
    expect(src).not.toMatch(/IT IS 3PM/)
  })
})
