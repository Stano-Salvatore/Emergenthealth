import { describe, it, expect, vi } from "vitest"

// The drift report lists what changed alongside a shift — "alcohol: 9 days,
// up from 1". It picked drinks out of the intake log by name, and the names
// it knew were "alcohol", "beer" and "wine". Spirits have their own button on
// the Intake screen, so a month of shots never reached the list, and when
// nothing else moved the push ended "Nothing logged accounts for it — did
// something change that isn't in the app?" about something that was.

const state = vi.hoisted(() => ({ intake: [] as { type: string; amountMl: number; loggedAt: Date }[] }))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn(async () => []) },
    habitCompletion: { findMany: vi.fn(async () => []) },
    habit: { findMany: vi.fn(async () => []) },
    stravaActivity: { findMany: vi.fn(async () => []) },
    intakeLog: { findMany: vi.fn(async () => state.intake) },
    $queryRaw: vi.fn(async () => []),
  },
}))
vi.mock("@/lib/mood-series", () => ({ loadMoodSeries: vi.fn(async () => []) }))

import { loadDriftReport, rollingWindows } from "@/lib/drift-load"
import { addDaysISO } from "@/lib/local-date"

describe("drift factors", () => {
  it("counts spirits as alcohol", async () => {
    const today = "2026-09-27"
    const windows = rollingWindows(today)
    const at = (day: string) => new Date(day + "T19:00:00Z")
    state.intake = [
      // Nine evenings of shots in the recent thirty days, one in the thirty before.
      ...Array.from({ length: 9 }, (_, i) => ({ type: "spirits", amountMl: 40, loggedAt: at(addDaysISO(windows.recent.from, i * 3)) })),
      { type: "spirits", amountMl: 40, loggedAt: at(addDaysISO(windows.prior.from, 5)) },
    ]
    const report = await loadDriftReport("u1", "UTC", windows)
    const alcohol = report.factors.find(f => f.label === "alcohol")
    expect(alcohol, `factors were: ${report.factors.map(f => f.label).join(", ") || "none"}`).toBeDefined()
    expect(alcohol!.recent).toBe(9)
    expect(report.factors.some(f => f.label === "spirits")).toBe(false)
  })
})
