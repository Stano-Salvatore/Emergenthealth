import { describe, it, expect } from "vitest"
import { nextOccurrence, occurrencesBetween, normalizeRepeat, repeatLabel } from "@/lib/recurrence"

describe("nextOccurrence", () => {
  it("steps daily, skips weekends for weekdays", () => {
    expect(nextOccurrence("2026-09-09", "daily")).toBe("2026-09-10")
    // Fri 11 Sep → Mon 14 Sep
    expect(nextOccurrence("2026-09-11", "weekdays")).toBe("2026-09-14")
  })

  it("keeps the anchor's weekday for weekly, even after a gap", () => {
    // 2026-09-09 is a Wednesday
    expect(nextOccurrence("2026-09-09", "weekly")).toBe("2026-09-16")
    expect(nextOccurrence("2026-09-09", "weekly", "2026-09-20")).toBe("2026-09-23")
  })

  it("clamps monthly to the month's length and keeps the original day", () => {
    expect(nextOccurrence("2026-01-31", "monthly")).toBe("2026-02-28")
    expect(nextOccurrence("2026-01-31", "monthly", "2026-02-28")).toBe("2026-03-31")
    expect(nextOccurrence("2024-02-29", "yearly")).toBe("2025-02-28")
  })
})

describe("occurrencesBetween", () => {
  it("expands a rule inside a window, honouring until and exceptions", () => {
    expect(occurrencesBetween("2026-09-01", "weekly", "2026-09-10", "2026-09-30", { exceptions: ["2026-09-22"] }))
      .toEqual(["2026-09-15", "2026-09-29"])
    expect(occurrencesBetween("2026-09-01", "daily", "2026-09-01", "2026-09-05", { until: "2026-09-03" }))
      .toEqual(["2026-09-01", "2026-09-02", "2026-09-03"])
    expect(occurrencesBetween("2026-09-04", null, "2026-09-01", "2026-09-30")).toEqual(["2026-09-04"])
    expect(occurrencesBetween("2026-09-04", null, "2026-09-10", "2026-09-30")).toEqual([])
  })
})

describe("normalizeRepeat / repeatLabel", () => {
  it("reads the words people use and labels the rule", () => {
    expect(normalizeRepeat("every weekday")).toBe("weekdays")
    expect(normalizeRepeat("once")).toBeNull()
    expect(normalizeRepeat("fortnightly")).toBeNull()
    expect(repeatLabel("weekly", "2026-09-09")).toBe("Every Wednesday")
    expect(repeatLabel("monthly", "2026-09-03")).toBe("Monthly on the 3rd")
    expect(repeatLabel("yearly", "2026-09-09")).toBe("Yearly on 9 Sep")
  })
})
