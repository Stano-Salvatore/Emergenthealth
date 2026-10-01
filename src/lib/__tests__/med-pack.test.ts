import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { activeOn, adherenceOver } from "@/lib/med-schedule"
import { followUpsDue } from "@/lib/med-followup"

// The pill's 21 days on and 7 off: a daily reminder rang through the break
// week, adherence counted the break as missed pills, and the missed-dose
// follow-up asked about pills nobody was meant to take.

const pill = {
  id: "p1", name: "Pill", times: ["21:00"], daysOfWeek: [], active: true,
  packOnDays: 21, packOffDays: 7, packStart: "2026-09-10",
}

describe("a pack rhythm", () => {
  it("runs the 21 active days and rests the 7 after", () => {
    expect(activeOn(pill, "2026-09-10")).toBe(true)
    expect(activeOn(pill, "2026-09-30")).toBe(true)  // day 21
    expect(activeOn(pill, "2026-10-01")).toBe(false) // break day 1
    expect(activeOn(pill, "2026-10-07")).toBe(false) // break day 7
    expect(activeOn(pill, "2026-10-08")).toBe(true)  // next pack
  })

  it("nothing is due before the first pack", () => {
    expect(activeOn(pill, "2026-09-09")).toBe(false)
  })

  it("a schedule without a pack is untouched", () => {
    expect(activeOn({ ...pill, packOnDays: null, packOffDays: null, packStart: null }, "2026-10-03")).toBe(true)
  })

  it("adherence does not count the break as missed", () => {
    const days = ["2026-09-30", "2026-10-01", "2026-10-02"]
    const [a] = adherenceOver([pill], [{ day: "2026-09-30", name: "Pill" }], days)
    expect(a.expected).toBe(1)
    expect(a.pct).toBe(100)
  })

  it("the missed-dose follow-up stays quiet in the break", () => {
    expect(followUpsDue([{ ...pill, times: ["08:00"] }], [], "2026-10-02", 10 * 60 + 30)).toEqual([])
  })

  it("every place that shapes a schedule passes the pack along", () => {
    for (const f of [
      "src/app/api/cron/med-reminders/route.ts", "src/app/api/med-schedule/route.ts", "src/app/api/calendar/overlay/route.ts",
      "src/lib/health-report.ts", "src/lib/native/notifications.ts", "src/app/api/med-schedule/took/route.ts",
    ]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/packOnDays|packOf\(/)
    }
  })
})
