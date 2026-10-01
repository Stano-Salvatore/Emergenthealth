import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { todayDoseLines, type DoseLike } from "@/lib/med-schedule"

const TODAY = "2026-10-01"
const elicea = { id: "s1", name: "Elicea", dose: "10 mg", times: ["08:00", "21:00"], daysOfWeek: [], active: true }
const vitD = { id: "s2", name: "Vitamin D", dose: null, times: ["09:00"], daysOfWeek: [], active: true }
const weekendOnly = { id: "s3", name: "Iron", dose: null, times: ["10:00"], daysOfWeek: [0, 6], active: true }
const at = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const dose = (name: string, hhmm: string, day = TODAY): DoseLike => ({ day, name, minutes: at(hhmm), at: Date.parse(`${day}T${hhmm}:00Z`) })

describe("todayDoseLines", () => {
  it("says, per scheduled time, whether the dose is logged, not logged yet, or still to come", () => {
    const lines = todayDoseLines([elicea, vitD], [dose("Elicea", "08:10")], TODAY, at("14:00"))
    expect(lines).toEqual([
      "Elicea (10 mg): 08:00 logged, 21:00 due later",
      "Vitamin D: 09:00 not logged yet",
    ])
  })

  it("a dose ticked off late still covers the morning slot", () => {
    const lines = todayDoseLines([elicea], [dose("Elicea", "11:30")], TODAY, at("12:00"))
    expect(lines[0]).toBe("Elicea (10 mg): 08:00 logged, 21:00 due later")
  })

  it("leaves out a schedule that does not run today", () => {
    expect(todayDoseLines([weekendOnly], [], TODAY, at("12:00"))).toEqual([]) // 1 Oct 2026 is a Thursday
  })

  it("a time inside its grace window is not yet called unlogged", () => {
    expect(todayDoseLines([vitD], [], TODAY, at("09:30"))).toEqual(["Vitamin D: 09:00 due now"])
  })
})

describe("Emergy's context", () => {
  it("carries today's dose status and tells him how to treat an unlogged one", () => {
    const src = readFileSync("src/lib/claude.ts", "utf8")
    expect(src).toMatch(/todayDoseLines\(/)
    expect(src).toMatch(/Today's scheduled doses/)
  })
})
