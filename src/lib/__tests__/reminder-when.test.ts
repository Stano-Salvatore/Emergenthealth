import { describe, it, expect } from "vitest"
import { parseHhMm, addDays, resolveReminderWhen } from "@/lib/reminder-when"

const TODAY = "2026-09-02"

describe("parseHhMm", () => {
  it("reads a time", () => {
    expect(parseHhMm("06:30")).toBe(390)
    expect(parseHhMm("6:30")).toBe(390)
  })
  it("rejects nonsense rather than guessing", () => {
    expect(parseHhMm("25:00")).toBeNull()
    expect(parseHhMm("06:99")).toBeNull()
    expect(parseHhMm("soon")).toBeNull()
    expect(parseHhMm(null)).toBeNull()
  })
})

describe("resolveReminderWhen", () => {
  it("puts a time still ahead of us today", () => {
    // 14:00 now, asked for 18:00.
    const w = resolveReminderWhen({ time: "18:00", today: TODAY, nowMinutes: 14 * 60 })
    expect(w).toEqual({ dueDate: TODAY, reminderTime: "18:00", label: "today at 18:00" })
  })

  it("rolls a time that has passed to tomorrow", () => {
    // 19:00 now, asked for 06:00 — an alarm set in the past never rings, so
    // this is the case that decides whether the feature works at all.
    const w = resolveReminderWhen({ time: "06:00", today: TODAY, nowMinutes: 19 * 60 })
    expect(w).toEqual({ dueDate: "2026-09-03", reminderTime: "06:00", label: "tomorrow at 06:00" })
  })

  it("treats this exact minute as tomorrow", () => {
    const w = resolveReminderWhen({ time: "14:30", today: TODAY, nowMinutes: 14 * 60 + 30 })
    expect(w.dueDate).toBe("2026-09-03")
  })

  it("honours a date the user named even if that time has gone today", () => {
    const w = resolveReminderWhen({ time: "06:00", dueDate: TODAY, today: TODAY, nowMinutes: 19 * 60 })
    expect(w).toEqual({ dueDate: TODAY, reminderTime: "06:00", label: "today at 06:00" })
  })

  it("names a further-off day rather than saying 'tomorrow'", () => {
    const w = resolveReminderWhen({ time: "09:15", dueDate: "2026-09-20", today: TODAY, nowMinutes: 600 })
    expect(w.label).toBe("on 2026-09-20 at 09:15")
  })

  it("says plainly when a reminder will never ring", () => {
    const w = resolveReminderWhen({ today: TODAY, nowMinutes: 600 })
    expect(w.dueDate).toBeNull()
    expect(w.label).toMatch(/won't ring/)
  })

  it("keeps the scheduler's 09:00 default visible when only a date is given", () => {
    const w = resolveReminderWhen({ dueDate: "2026-09-03", today: TODAY, nowMinutes: 600 })
    expect(w).toEqual({ dueDate: "2026-09-03", reminderTime: null, label: "tomorrow at 09:00" })
  })
})

describe("addDays", () => {
  it("crosses a month end", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01")
  })
})
