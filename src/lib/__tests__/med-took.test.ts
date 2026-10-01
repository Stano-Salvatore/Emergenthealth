import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { planTook } from "@/lib/med-took"
import type { DoseLike } from "@/lib/med-schedule"

const TZ = "Europe/Bratislava"
const TODAY = "2026-10-01"
const NOW = new Date("2026-10-01T08:10:00Z") // 10:10 in Bratislava
const elicea = { id: "s1", name: "Elicea", dose: "10 mg", times: ["08:00", "21:00"], daysOfWeek: [], active: true }
const vitD = { id: "s2", name: "Vitamin D", dose: null, times: ["08:30"], daysOfWeek: [], active: true }
const logged = (name: string, iso: string): DoseLike => ({ day: TODAY, name, at: Date.parse(iso), minutes: 8 * 60 + 5 })

describe("planTook", () => {
  it("files the dose at the tap by default", () => {
    const p = planTook([{ scheduleId: "s1", time: "08:00" }], [elicea], [], TODAY, TZ, NOW)
    expect(p.write).toEqual([{ scheduleId: "s1", name: "Elicea", dose: "10 mg", at: NOW }])
  })

  it("files a follow-up's dose at the scheduled time, in the user's zone", () => {
    const p = planTook([{ scheduleId: "s1", time: "08:00", atScheduled: true }], [elicea], [], TODAY, TZ, NOW)
    expect(p.write[0].at.toISOString()).toBe("2026-10-01T06:00:00.000Z")
  })

  it("never logs a second dose for a time already covered — a tap after ticking it off in the app", () => {
    const p = planTook([{ scheduleId: "s1", time: "08:00" }], [elicea], [logged("Elicea", "2026-10-01T06:05:00Z")], TODAY, TZ, NOW)
    expect(p.write).toEqual([])
    expect(p.already).toEqual(["Elicea"])
  })

  it("ignores a schedule that is not theirs or no longer exists", () => {
    const p = planTook([{ scheduleId: "nope", time: "08:00" }], [elicea], [], TODAY, TZ, NOW)
    expect(p.write).toEqual([])
  })

  it("handles several medicines from one notification", () => {
    const p = planTook([{ scheduleId: "s1", time: "08:00" }, { scheduleId: "s2", time: "08:30" }], [elicea, vitD], [], TODAY, TZ, NOW)
    expect(p.write.map(w => w.name)).toEqual(["Elicea", "Vitamin D"])
  })
})

describe("the button", () => {
  const sw = readFileSync("public/sw.js", "utf8")
  it("med notifications carry Took it, and the worker posts it to the endpoint", () => {
    expect(sw).toMatch(/action: "took"/)
    expect(sw).toMatch(/\/api\/med-schedule\/took/)
  })

  it("the endpoint plans before it writes", () => {
    expect(readFileSync("src/app/api/med-schedule/took/route.ts", "utf8")).toMatch(/planTook\(/)
  })
})
