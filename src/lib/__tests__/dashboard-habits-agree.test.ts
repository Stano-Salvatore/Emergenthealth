import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// Source guards for the habit numbers on Home, the Week page and the Sunday
// review. The arithmetic lives in lib/habit-schedule (weekTally, habitStreak)
// and is unit-tested there; what these pin is that the pages actually use it.

/** Comments may describe the old code; the code may not be it. */
const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

describe("Home's habit numbers agree with each other", () => {
  // Five habits, two of them Mon/Wed/Fri, on a Tuesday with all three due
  // ones done: the phone row read "3/3" over a bar 60% full, the desktop tile
  // read "3/5", QuickHabits read 3/3. The count said one thing, the bar and
  // the tile divided by every habit including the two not asked for today.
  const home = code("src/app/dashboard/page.tsx")

  it("the fallback score's habit ratio is out of today's due habits", () => {
    expect(home).not.toMatch(/doneToday\s*\/\s*habits\.length/)
    expect(home).toMatch(/habitsRatio:\s*habitsWithStreaks\.length\s*>\s*0\s*\?\s*doneToday\s*\/\s*habitsWithStreaks\.length/)
  })

  it("the desktop tile says done of due, not done of all", () => {
    expect(home).not.toMatch(/\$\{doneToday\}\/\$\{habits\.length\}/)
  })

  it("QuickHabits gets every due habit, so 'All habits done!' means all", () => {
    expect(home).not.toMatch(/habitsWithStreaks\.slice\(/)
  })
})

describe("streaks on Home and the widget are the Habits page's streaks", () => {
  // Home loaded eight days of completions and walked the streak over them, so
  // a daily habit forty days running showed 🔥8 on Home and 40 on the Habits
  // page. Neither Home nor the widget applied vacation mode, so a week away
  // broke the streak there while the Habits page kept it.
  for (const f of ["src/app/dashboard/page.tsx", "src/app/api/widget/habits/route.ts"]) {
    it(`${f} loads a year of history and freezes vacation days`, () => {
      const src = code(f)
      expect(src, "completions from a one-week window").not.toMatch(/completions:\s*\{\s*where:\s*\{\s*date:\s*\{\s*gte:\s*weekAgo/)
      expect(src).toMatch(/366/)
      expect(src).toMatch(/getVacationWindow\(/)
      expect(src).toMatch(/habitStreak\([^)]*,\s*isFrozen\)/)
    })
  }
})

describe("the Week page and the Sunday review count against the schedule", () => {
  // Percentages divided by ring rows so far (3/2d · 150% on a Wednesday
  // before the sync) or by seven (a Mon/Wed/Fri habit kept perfectly read
  // 43%, and the review told Emergy "Gym: 3/7 days").
  const week = code("src/app/dashboard/week/page.tsx")
  const review = code("src/lib/weekly-review.ts")

  it("habits are tallied by weekTally, skips included", () => {
    for (const src of [week, review]) {
      expect(src).toMatch(/weekTally\(/)
      expect(src).toMatch(/skips:\s*\{/)
      expect(src).not.toMatch(/completions\.length\s*\/\s*(totalDays|daysThisWeek)/)
    }
  })

  it("water and focus are per day of the week so far, not per ring row", () => {
    expect(week).not.toMatch(/totalDays/)
    expect(week).toMatch(/\{waterGoalDays\}\/\{elapsedDays\}/)
  })

  it("a drink is filed on the user's day, not the server's", () => {
    // 00:30 Tuesday in Prague was counted on Monday.
    expect(week).not.toMatch(/format\(new Date\(w\.loggedAt\)/)
    expect(week).toMatch(/localDateStr\(timezone,\s*w\.loggedAt\)/)
  })

  it("mood comes from both tables", () => {
    // A week of check-in moods left the column blank and the card hidden; one
    // Emergy log_mood of 2 then brought it back as "avg mood 2.0".
    expect(week).toMatch(/loadMoodSeries\(/)
    expect(week).not.toMatch(/moodLog\.findMany/)
  })
})

describe("the phone gauge says which scale it is on", () => {
  // The gauge showed the "vs your usual" score over four bars on the absolute
  // goal scale, and on a day without a daily score switched scales silently.
  it("Home draws the daily score's own components when it has one", () => {
    const home = code("src/app/dashboard/page.tsx")
    expect(home).toMatch(/dailyPillars\(/)
  })

  it("and the gauge labels both scales", () => {
    const mobile = code("src/components/dashboard/MobileToday.tsx")
    expect(mobile).toMatch(/"Vs your usual/)
    expect(mobile).toMatch(/"Vs your goals"/)
  })
})

describe("Toggl doesn't point at a button that isn't there", () => {
  // The page said the timer "stays available on every screen", bottom right.
  // It was mounted only on this page, so on Habits there was nothing there.
  it("the page carries no copy about a floating button", () => {
    const page = code("src/app/dashboard/toggl/page.tsx")
    expect(page).not.toMatch(/every screen/i)
    expect(page).not.toMatch(/bottom right/i)
  })

  it("the panel renders in place rather than as a drawer", () => {
    const panel = code("src/components/toggl/TogglPanel.tsx")
    expect(panel).not.toMatch(/translate-x-full/)
    expect(panel).not.toMatch(/\bfixed\b/)
  })
})
