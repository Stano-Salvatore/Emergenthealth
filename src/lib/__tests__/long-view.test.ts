import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { seasonWindows } from "@/lib/drift-load"
import { monthlyAverages } from "@/lib/long-view"

// Apple's Longevity tab is the season's feature; this is its honest cousin.
// No invented "health age" — a quarter measured against the quarter before,
// through the same drift engine that already refuses to narrate noise, plus
// twelve months of plain monthly averages where an absent month stays a hole.

describe("seasonWindows", () => {
  it("is 90 days against the 90 before, contiguous", () => {
    const { recent, prior } = seasonWindows("2026-09-25")
    expect(recent).toEqual({ from: "2026-06-28", to: "2026-09-25" })
    expect(prior).toEqual({ from: "2026-03-30", to: "2026-06-27" })
    const span = (w: { from: string; to: string }) =>
      (Date.parse(w.to) - Date.parse(w.from)) / 86_400_000 + 1
    expect(span(recent)).toBe(90)
    expect(span(prior)).toBe(90)
  })
})

describe("monthlyAverages", () => {
  const row = (date: string, sleepDuration: number | null, steps: number | null) => ({ date, sleepDuration, steps })

  it("averages what a month has and skips what it lacks", () => {
    const rows = [
      row("2026-08-01", 420, 8000), row("2026-08-02", 480, null),
      row("2026-09-01", null, 12000),
    ]
    const months = monthlyAverages(rows)
    const aug = months.find(m => m.month === "2026-08")
    expect(aug?.sleepH).toBe(7.5)
    expect(aug?.steps).toBe(8000)
    const sep = months.find(m => m.month === "2026-09")
    expect(sep?.sleepH).toBeNull()
    expect(sep?.steps).toBe(12000)
  })

  it("a month with no rows is missing, never a zero bar", () => {
    const months = monthlyAverages([row("2026-05-10", 400, 9000), row("2026-07-10", 410, 9500)])
    expect(months.map(m => m.month)).toEqual(["2026-05", "2026-07"])
  })
})

describe("the long view is wired end to end", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("the API judges the quarter through the drift engine", () => {
    const route = stripped("src/app/api/longview/route.ts")
    expect(route).toMatch(/seasonWindows\(/)
    expect(route).toMatch(/loadDriftReport\(/)
  })
  it("the stats page shows it", () => {
    expect(stripped("src/app/dashboard/stats/page.tsx")).toMatch(/LongView/)
  })
  it("Emergy can answer at quarter scale, and can point at the page", () => {
    const chat = stripped("src/lib/claude.ts")
    expect(chat).toContain('"season"')
    expect(chat).toContain("/dashboard/stats")
  })
})
