import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { followUpsDue, followUpText, FOLLOW_UP_AFTER_MIN } from "@/lib/med-followup"
import type { DoseLike } from "@/lib/med-schedule"

const TODAY = "2026-10-01"
const at = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const elicea = { id: "s1", name: "Elicea", dose: "10 mg", times: ["08:00", "21:00"], daysOfWeek: [], active: true }
const vitD = { id: "s2", name: "Vitamin D", dose: null, times: ["08:30"], daysOfWeek: [], active: true }
const lunch = { id: "s3", name: "Creon", dose: null, times: ["12:00", "13:00"], daysOfWeek: [], active: true }
const dose = (name: string, hhmm: string): DoseLike => ({ day: TODAY, name, minutes: at(hhmm), at: Date.parse(`${TODAY}T${hhmm}:00Z`) })

describe("followUpsDue", () => {
  it("asks about a dose still unlogged two hours after its time", () => {
    const due = followUpsDue([elicea], [], TODAY, at("10:05"))
    expect(due).toEqual([{ scheduleId: "s1", name: "Elicea", dose: "10 mg", time: "08:00" }])
  })

  it("is quiet before the two hours are up, and once the window has passed", () => {
    expect(followUpsDue([elicea], [], TODAY, at("08:00") + FOLLOW_UP_AFTER_MIN - 1)).toEqual([])
    expect(followUpsDue([elicea], [], TODAY, at("13:00"))).toEqual([])
  })

  it("never asks about a dose that is logged", () => {
    expect(followUpsDue([elicea], [dose("Elicea", "08:05")], TODAY, at("10:05"))).toEqual([])
  })

  it("never asks at night — a 21:00 dose is not worth waking anyone at 23:00", () => {
    expect(followUpsDue([elicea], [dose("Elicea", "08:05")], TODAY, at("23:05"))).toEqual([])
  })

  it("stays out of the way once the next time of the same medicine has come", () => {
    // 12:00 unlogged, but by 14:05 the 13:00 dose is the live question.
    expect(followUpsDue([lunch], [], TODAY, at("14:05")).map(f => f.time)).toEqual([])
  })

  it("gathers several medicines into one question", () => {
    const due = followUpsDue([elicea, vitD], [], TODAY, at("10:35"))
    expect(due.map(f => f.name)).toEqual(["Elicea", "Vitamin D"])
  })
})

describe("followUpText", () => {
  it("one dose", () => {
    expect(followUpText([{ scheduleId: "s1", name: "Elicea", dose: "10 mg", time: "08:00" }]))
      .toBe("Your 08:00 Elicea (10 mg) isn't logged yet. Did you take it?")
  })

  it("several doses", () => {
    expect(followUpText([
      { scheduleId: "s1", name: "Elicea", dose: null, time: "08:00" },
      { scheduleId: "s2", name: "Vitamin D", dose: null, time: "08:30" },
    ])).toBe("Your 08:00 Elicea and 08:30 Vitamin D aren't logged yet. Did you take them?")
  })

  it("never tells anyone to take it now — that is a call for them and their doctor", () => {
    const t = followUpText([{ scheduleId: "s1", name: "Elicea", dose: null, time: "08:00" }])
    expect(t).not.toMatch(/take it now|should|don't forget/i)
  })
})

describe("the cron", () => {
  const src = readFileSync("src/app/api/cron/med-reminders/route.ts", "utf8")
  it("sends the follow-up into the chat with the medications page as its button, once per dose", () => {
    expect(src).toMatch(/followUpsDue\(/)
    expect(src).toMatch(/sayAsEmergy\([^)]*\{\s*link: "\/dashboard\/intake\?tab=meds"/)
    expect(src).toMatch(/\|f`/)
  })
})
