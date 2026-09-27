import { describe, it, expect } from "vitest"
import { zonedClock } from "@/lib/local-date"

// Schedules keep their clock time bare: a dose "08:00", a habit reminder
// "21:00". The calendar overlay turned those into instants with the server's
// `new Date(y, m, d, h, min)`, and the server runs in UTC — so in Prague every
// dose, habit and reminder was drawn two hours late (one in winter), and a
// 23:00 habit reminder moved into the next day's column.

describe("zonedClock", () => {
  it("reads a schedule's clock time as the user's", () => {
    expect(zonedClock("Europe/Prague", "2026-09-27", "08:00")?.toISOString()).toBe("2026-09-27T06:00:00.000Z")
    expect(zonedClock("Europe/Prague", "2026-01-15", "08:00")?.toISOString()).toBe("2026-01-15T07:00:00.000Z")
  })

  it("keeps a late reminder on its own day", () => {
    const at = zonedClock("Europe/Prague", "2026-09-27", "23:00")!
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(at)).toBe("2026-09-27")
  })

  it("accepts the single-digit hours schedules were saved with", () => {
    expect(zonedClock("Europe/Prague", "2026-09-27", "8:00")?.toISOString()).toBe("2026-09-27T06:00:00.000Z")
  })

  it("refuses what it cannot read rather than guessing", () => {
    expect(zonedClock("Europe/Prague", "2026-09-27", "soon")).toBeNull()
    expect(zonedClock("Europe/Prague", "2026-09-27", "25:00")).toBeNull()
  })
})
