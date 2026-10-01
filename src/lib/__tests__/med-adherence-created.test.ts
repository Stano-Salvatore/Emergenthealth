import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { adherenceOver } from "@/lib/med-schedule"

// A schedule added today read "0% taken over 14 days · 14 days incomplete":
// the fortnight before it existed was counted as two weeks of missed doses —
// on the page, in Emergy's adherence read and in the doctor report.

const days = Array.from({ length: 14 }, (_, i) => `2026-09-${String(17 + i).padStart(2, "0")}`) // 17–30 Sep
const base = { id: "s1", name: "Elicea", times: ["08:00"], daysOfWeek: [], active: true }

describe("adherence starts when the plan does", () => {
  it("a schedule created on 28 Sep is judged on 28–30 Sep only", () => {
    const [a] = adherenceOver([{ ...base, createdDay: "2026-09-28" }], [], days)
    expect(a.expected).toBe(3)
    expect(a.daysCounted).toBe(3)
    expect(a.missedDays).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"])
  })

  it("one created today expects nothing yet — no figure rather than 0%", () => {
    const [a] = adherenceOver([{ ...base, createdDay: "2026-10-01" }], [], days)
    expect(a.pct).toBeNull()
    expect(a.daysCounted).toBe(0)
  })

  it("an explicit start date the user set wins over when the row was made", () => {
    const [a] = adherenceOver([{ ...base, createdDay: "2026-10-01", startDate: "2026-09-20" }], [], days)
    expect(a.daysCounted).toBe(11)
  })

  it("all three readers pass the day the schedule was made", () => {
    for (const f of ["src/app/api/med-schedule/route.ts", "src/lib/health-report.ts", "src/lib/claude.ts"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/createdDay:/)
    }
  })

  it("the card names the days it actually counted", () => {
    expect(readFileSync("src/components/medications/MedScheduleCard.tsx", "utf8")).toMatch(/daysCounted/)
  })
})
