import { describe, it, expect } from "vitest"
import {
  reminderNotifId, habitNotifId, medNotifId, buildNudges,
} from "@/lib/native/notifications"

// Android local notifications are keyed by a 32-bit int, and scheduling two
// things with the same id silently replaces one with the other. A collision
// between a habit and a medication dose would mean a dose that never buzzes
// and no error anywhere — so the partitioning is worth pinning down.

const ids = (n: number, make: (key: string) => number) =>
  Array.from({ length: n }, (_, i) => make(`clx${i}abcdefghij`))

describe("notification id partitioning", () => {
  it("keeps each kind inside its own block", () => {
    for (const id of ids(500, k => reminderNotifId(k))) {
      expect(id).toBeGreaterThanOrEqual(0)
      expect(id).toBeLessThan(400_000)
    }
    for (const id of ids(500, k => habitNotifId(k, 6))) {
      expect(id).toBeGreaterThanOrEqual(400_000)
      expect(id).toBeLessThan(890_000)
    }
    for (const id of ids(500, k => medNotifId(k, 6, 6))) {
      expect(id).toBeGreaterThanOrEqual(1_000_000)
      expect(id).toBeLessThan(2_000_000)
    }
  })

  it("never lets meds reach the fixed nudge ids", () => {
    const nudgeIds = new Set(buildNudges({ morningHour: 8, noon: true, evening: true }).map(n => n.id))
    for (const id of ids(1000, k => medNotifId(k, 6, 6))) {
      expect(nudgeIds.has(id)).toBe(false)
    }
  })

  it("gives every dose slot of one schedule a distinct id", () => {
    const seen = new Set<number>()
    for (let day = 0; day < 7; day++) {
      for (let t = 0; t < 7; t++) seen.add(medNotifId("clxmed123456", day, t))
    }
    expect(seen.size).toBe(49)
  })

  it("gives every day of one habit a distinct id", () => {
    const seen = new Set(Array.from({ length: 7 }, (_, d) => habitNotifId("clxhabit1234", d)))
    expect(seen.size).toBe(7)
  })

  it("is stable across calls, so a resync reuses the same slot", () => {
    expect(medNotifId("clxmed123456", 3, 2)).toBe(medNotifId("clxmed123456", 3, 2))
    expect(habitNotifId("clxhabit1234", 3)).toBe(habitNotifId("clxhabit1234", 3))
  })

  it("separates two different schedules", () => {
    expect(medNotifId("clxmedAAAAAA", 0, 0)).not.toBe(medNotifId("clxmedBBBBBB", 0, 0))
  })
})

describe("buildNudges — driven by Settings, not hard-coded", () => {
  it("uses the morning hour the user picked", () => {
    expect(buildNudges({ morningHour: 6, noon: true, evening: true })[0].hour).toBe(6)
    expect(buildNudges({ morningHour: 11, noon: true, evening: true })[0].hour).toBe(11)
  })

  it("honours the noon and evening toggles", () => {
    expect(buildNudges({ morningHour: 8, noon: true, evening: true })).toHaveLength(3)
    expect(buildNudges({ morningHour: 8, noon: false, evening: true })).toHaveLength(2)
    expect(buildNudges({ morningHour: 8, noon: false, evening: false })).toHaveLength(1)
  })

  it("keeps the morning nudge whatever else is off", () => {
    const only = buildNudges({ morningHour: 7, noon: false, evening: false })
    expect(only[0].title).toContain("Morning")
    expect(only[0].hour).toBe(7)
  })

  it("clamps an out-of-range hour rather than scheduling nonsense", () => {
    expect(buildNudges({ morningHour: 99, noon: false, evening: false })[0].hour).toBe(23)
    expect(buildNudges({ morningHour: -5, noon: false, evening: false })[0].hour).toBe(0)
  })
})
