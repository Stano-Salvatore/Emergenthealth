import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dayAheadLine } from "@/lib/brief-day-ahead"

const strip = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const hhmm = (iso: string) => iso.slice(11, 16)
const NOW = Date.parse("2026-10-02T12:18:00Z")

describe("what is left of the day, as one line for the brief", () => {
  it("lists only what is still ahead: later events, habits not done, reminders, doses due", () => {
    const line = dayAheadLine({
      nowMs: NOW, fmtTime: hhmm,
      events: [
        { title: "Standup", start: "2026-10-02T09:00:00Z", isAllDay: false },
        { title: "Dentist", start: "2026-10-02T14:00:00Z", isAllDay: false },
        { title: "Name day", start: "2026-10-02", isAllDay: true },
      ],
      habitsLeft: ["Morning walk", "Read"],
      remindersDue: ["Call the bank"],
      remindersOverdue: ["Pay rent"],
      dosesDue: ["Elicea 21:00 due later"],
    })!
    expect(line).toContain("14:00 Dentist")
    expect(line).not.toContain("Standup")
    expect(line).toContain("all day: Name day")
    expect(line).toContain("Morning walk, Read")
    expect(line).toContain("Call the bank")
    expect(line).toContain("overdue: Pay rent")
    expect(line).toContain("Elicea 21:00 due later")
  })

  it("an empty rest of the day is no line, not a list of nothings", () => {
    expect(dayAheadLine({ nowMs: NOW, fmtTime: hhmm, events: [], habitsLeft: [], remindersDue: [], remindersOverdue: [], dosesDue: [] })).toBeNull()
  })

  it("keeps a long day short", () => {
    const line = dayAheadLine({
      nowMs: NOW, fmtTime: hhmm,
      events: Array.from({ length: 8 }, (_, i) => ({ title: `E${i}`, start: `2026-10-02T${13 + i}:00:00Z`, isAllDay: false })),
      habitsLeft: Array.from({ length: 9 }, (_, i) => `H${i}`),
      remindersDue: [], remindersOverdue: [], dosesDue: [],
    })!
    expect(line).not.toContain("E5")
    expect(line).toContain("+4 more")
  })
})

describe("the brief is shaped sleep first, then the day", () => {
  const route = strip("src/app/api/briefing/route.ts")
  it("is told the order, and the strain and baseline notes belong inside the sleep part", () => {
    expect(route).toMatch(/First, last night's sleep/)
    expect(route).toMatch(/Then what is left of/)
    expect(route).not.toMatch(/Pick the two or three things that actually matter right now/)
  })
  it("is given what is left of the day, and the night's score", () => {
    expect(route).toMatch(/dayAheadLine\(/)
    expect(route).toMatch(/sleepScore: true/)
  })
  it("today's cached brief is rewritten in the new shape rather than served in the old one", () => {
    expect(route).toMatch(/daily_briefing_v2_/)
  })
})

describe("a night is named by the night it is about", () => {
  it("strain and baseline notes from an older night are not called last night's", () => {
    const route = strip("src/app/api/briefing/route.ts")
    expect(route).toMatch(/nightOf\(vitalsDate\)/)
    expect(route).toMatch(/latestDate === todayStr/)
    expect(route).not.toMatch(/`Last night as a whole:/)
  })
})
