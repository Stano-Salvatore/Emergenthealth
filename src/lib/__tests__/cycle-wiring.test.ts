import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { NAV_ITEMS, OPT_IN_ROUTES } from "@/lib/nav-items"
import { linkFor } from "@/lib/app-links"

const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

describe("cycle tracking is opt-in in the nav", () => {
  it("the page is in the nav map, marked as opt-in", () => {
    expect(NAV_ITEMS.find(i => i.href === "/dashboard/cycle")?.section).toBe("Body")
    expect(OPT_IN_ROUTES["/dashboard/cycle"]).toBe("cycle")
  })

  it("the sidebar hides an opt-in page until the server says it is on", () => {
    const sidebar = strip("src/components/layout/Sidebar.tsx")
    expect(sidebar).toMatch(/OPT_IN_ROUTES/)
    expect(sidebar).toMatch(/optIn/)
    expect(strip("src/app/api/preferences/sidebar/route.ts")).toMatch(/optIn/)
  })
})

describe("the home page", () => {
  it("renders the cycle card, which speaks only on the days homeCycleNote picks", () => {
    expect(strip("src/app/dashboard/page.tsx")).toMatch(/<CycleCard\b/)
    expect(strip("src/components/dashboard/CycleCard.tsx")).toMatch(/homeCycleNote\(/)
  })
})

describe("everything the cycle page promises exists", () => {
  it("Emergy can reach the page and log a day", () => {
    expect(linkFor("/dashboard/cycle")?.label).toBe("Cycle")
    const claude = strip("src/lib/claude.ts")
    expect(claude).toMatch(/name: "log_cycle"/)
    expect(claude).toMatch(/name === "log_cycle"/)
  })

  it("the health report carries the cycle", () => {
    expect(strip("src/lib/health-report.ts")).toMatch(/cycle/)
    expect(strip("src/app/dashboard/report/page.tsx")).toMatch(/cycle/i)
  })

  it("pill reminders skip the break week: schedules understand a pack", () => {
    expect(strip("src/app/api/med-schedule/route.ts")).toMatch(/packOnDays/)
    expect(strip("src/lib/med-schedule.ts")).toMatch(/packOnDays/)
  })

  it("the heads-up push says only \"Cycle heads-up\" on the lock screen, as the setting promises", () => {
    const cron = strip("src/app/api/cron/cycle-heads-up/route.ts")
    // The words themselves are pinned in cycle-heads-up.test.ts.
    expect(cron).toMatch(/\.\.\.HEADS_UP_PUSH/)
    expect(cron).not.toMatch(/title: "/)
    expect(readFileSync(".github/workflows/reminders-cron.yml", "utf8")).toMatch(/cycle-heads-up/)
  })
})
