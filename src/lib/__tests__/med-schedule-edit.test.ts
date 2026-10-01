import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { findSchedules, planScheduleEdit, type EditableSchedule } from "@/lib/med-schedule-edit"

const elicea: EditableSchedule = {
  id: "s1", name: "Elicea 10 mg", dose: "1 tablet", times: ["08:00"], daysOfWeek: [],
  active: true, remind: true, note: null, startDate: null, endDate: null,
}
const vitD: EditableSchedule = { ...elicea, id: "s2", name: "Vitamin D", dose: "2000 IU", times: ["09:00"] }
const atarax: EditableSchedule = { ...elicea, id: "s3", name: "Atarax 25 mg", dose: "½ tablet", times: ["22:00"] }
const all = [elicea, vitD, atarax]

describe("findSchedules", () => {
  it("finds a schedule by the name as people say it", () => {
    expect(findSchedules(all, "elicea").map(s => s.id)).toEqual(["s1"])
    expect(findSchedules(all, "Elicea 10mg").map(s => s.id)).toEqual(["s1"])
    expect(findSchedules(all, "vit d").map(s => s.id)).toEqual(["s2"])
  })

  it("returns every candidate when the name is ambiguous, and none when nothing fits", () => {
    const two = [elicea, { ...elicea, id: "s9", name: "Elicea 5 mg" }]
    expect(findSchedules(two, "elicea").map(s => s.id).sort()).toEqual(["s1", "s9"])
    expect(findSchedules(two, "Elicea 5 mg").map(s => s.id)).toEqual(["s9"])
    expect(findSchedules(all, "ibuprofen")).toEqual([])
  })
})

describe("planScheduleEdit", () => {
  const today = "2026-10-01"

  it("adds a time and keeps them in order", () => {
    const p = planScheduleEdit(elicea, { addTimes: ["21:00", "8:00"] }, today)
    expect(p.ok && p.data.times).toEqual(["08:00", "21:00"])
    expect(p.ok && p.summary).toMatch(/08:00, 21:00/)
  })

  it("removes a time, but never the last one", () => {
    const two = { ...elicea, times: ["08:00", "21:00"] }
    const p = planScheduleEdit(two, { removeTimes: ["21:00"] }, today)
    expect(p.ok && p.data.times).toEqual(["08:00"])
    const last = planScheduleEdit(elicea, { removeTimes: ["08:00"] }, today)
    expect(last.ok).toBe(false)
  })

  it("replaces the times, the days and the dose", () => {
    const p = planScheduleEdit(elicea, { times: ["07:30"], daysOfWeek: [1, 2, 3, 4, 5], dose: "½ tablet" }, today)
    expect(p.ok && p.data).toMatchObject({ times: ["07:30"], daysOfWeek: [1, 2, 3, 4, 5], dose: "½ tablet" })
    expect(p.ok && p.summary).toMatch(/Mon\/Tue\/Wed\/Thu\/Fri/)
  })

  it("pausing keeps the plan and silences it; stopping ends it today, so history still counts", () => {
    const paused = planScheduleEdit(elicea, { status: "paused" }, today)
    expect(paused.ok && paused.data).toMatchObject({ active: false })
    expect(paused.ok && "endDate" in paused.data).toBe(false)
    const stopped = planScheduleEdit(elicea, { status: "stopped" }, today)
    expect(stopped.ok && stopped.data).toMatchObject({ active: false, endDate: today })
    const resumed = planScheduleEdit({ ...elicea, active: false, endDate: "2026-09-01" }, { status: "active" }, today)
    expect(resumed.ok && resumed.data).toMatchObject({ active: true, endDate: null })
  })

  it("turns reminders off without touching the plan", () => {
    const p = planScheduleEdit(elicea, { remind: false }, today)
    expect(p.ok && p.data).toEqual({ remind: false })
  })

  it("an edit that changes nothing says so instead of claiming a change", () => {
    const p = planScheduleEdit(elicea, { addTimes: ["08:00"] }, today)
    expect(p.ok).toBe(false)
    expect(!p.ok && p.reason).toMatch(/already/)
  })

  it("throws away malformed times rather than saving them", () => {
    const p = planScheduleEdit(elicea, { addTimes: ["25:00", "noon"] }, today)
    expect(p.ok).toBe(false)
  })
})

describe("Emergy's tool", () => {
  const src = readFileSync("src/lib/claude.ts", "utf8")
  it("is declared and handled, and create_med_schedule no longer sends people to the page to edit", () => {
    expect(src).toMatch(/name: "update_med_schedule"/)
    expect(src).toMatch(/name === "update_med_schedule"/)
    expect(src).not.toMatch(/tell them to edit it on the Medications page instead/)
  })
})
