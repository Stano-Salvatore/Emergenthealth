import { describe, it, expect } from "vitest"
import { expandEvent } from "@/lib/app-events"

const base = {
  id: "ev1", title: "Standup", description: null, location: null, color: null,
  end: null as Date | null, isAllDay: false, repeatUntil: null as Date | null, exceptions: [] as string[], alertMinutes: 10,
}

describe("expandEvent", () => {
  it("keeps the wall-clock time across a clock change", () => {
    // 09:00 Prague on Mon 19 Oct 2026 (CEST, +02:00) = 07:00Z. Clocks go back on 25 Oct.
    const row = { ...base, start: new Date("2026-10-19T07:00:00Z"), repeat: "weekdays", end: new Date("2026-10-19T07:15:00Z") }
    const occ = expandEvent(row, new Date("2026-10-26T00:00:00Z"), new Date("2026-10-30T23:59:59Z"), "Europe/Prague")
    expect(occ.map(o => o.occurrence)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"])
    // After the change 09:00 Prague is 08:00Z, not 07:00Z.
    expect(occ[0].start).toBe("2026-10-26T08:00:00.000Z")
    expect(occ[0].end).toBe("2026-10-26T08:15:00.000Z")
    expect(occ[0].id).toBe("ev1:2026-10-26")
  })

  it("honours exceptions and the end of a series", () => {
    const row = { ...base, start: new Date("2026-09-01T10:00:00Z"), repeat: "weekly", exceptions: ["2026-09-15"], repeatUntil: new Date("2026-09-22T00:00:00Z") }
    const occ = expandEvent(row, new Date("2026-09-01T00:00:00Z"), new Date("2026-10-31T00:00:00Z"), "UTC")
    expect(occ.map(o => o.occurrence)).toEqual(["2026-09-01", "2026-09-08", "2026-09-22"])
  })

  it("expands an all-day yearly event by date, not by instant", () => {
    const row = { ...base, start: new Date("2026-05-12T00:00:00Z"), isAllDay: true, repeat: "yearly" }
    const occ = expandEvent(row, new Date("2027-05-01T00:00:00Z"), new Date("2027-05-31T00:00:00Z"), "Pacific/Auckland")
    expect(occ).toHaveLength(1)
    expect(occ[0].start).toBe("2027-05-12")
    expect(occ[0].isAllDay).toBe(true)
  })

  it("drops a one-off outside the window", () => {
    const row = { ...base, start: new Date("2026-09-01T10:00:00Z"), repeat: null }
    expect(expandEvent(row, new Date("2026-09-10T00:00:00Z"), new Date("2026-09-20T00:00:00Z"), "UTC")).toEqual([])
    expect(expandEvent(row, new Date("2026-08-30T00:00:00Z"), new Date("2026-09-02T00:00:00Z"), "UTC")).toHaveLength(1)
  })
})
