import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { zonedDateTime } from "@/lib/local-date"

// The bedtime proxy must be the longest quiet gap, not the last screen-off:
// a 3 a.m. glance at the clock must not move "phone down" to 3 a.m. unless
// the remaining night really was the longer half.

const db = vi.hoisted(() => ({
  events: [] as { at: Date; kind: string }[],
  ambient: [] as { lux: number | null }[],
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    phoneEvent: { findMany: async () => db.events },
    ambientSample: { findMany: async () => db.ambient },
  },
}))

const TZ = "Europe/Bratislava"
const at = (day: string, hhmm: string, kind = "screen_on") => {
  const d = zonedDateTime(TZ, `${day}T${hhmm}`)
  if (!d) throw new Error("bad time")
  return { at: d, kind }
}

import { phoneNightUse, MIN_NIGHT_GAP_MINUTES } from "@/lib/phone-day"

describe("phoneNightUse", () => {
  beforeEach(() => { db.events = []; db.ambient = [] })

  it("finds the night as the longest quiet gap, in local time", async () => {
    db.events = [
      at("2026-09-23", "21:30"),
      at("2026-09-23", "22:10"),
      at("2026-09-23", "22:12", "unlock"),
      at("2026-09-23", "23:15", "screen_off"),
      at("2026-09-24", "00:38"),
      at("2026-09-24", "00:40", "screen_off"),
      at("2026-09-24", "07:10"),
      at("2026-09-24", "07:12", "unlock"),
    ]
    const use = await phoneNightUse("u1", "2026-09-24", TZ)
    expect(use.phoneDownLocal).toBe("00:40")
    expect(use.pickedUpLocal).toBe("07:10")
    expect(use.quietMinutes).toBe(390)
    // screen_on/unlock between 22:00 and phone-down: 22:10, 22:12, 00:38.
    // The 23:15 screen_off is the phone being put down, not a pickup.
    expect(use.pickupsAfter22).toBe(3)
  })

  it("a 3 a.m. check splits the night and the longer half wins", async () => {
    db.events = [
      at("2026-09-23", "23:00", "screen_off"),
      at("2026-09-24", "03:00"),
      at("2026-09-24", "03:02", "screen_off"),
      at("2026-09-24", "08:30"),
    ]
    const use = await phoneNightUse("u1", "2026-09-24", TZ)
    expect(use.phoneDownLocal).toBe("03:02")
    expect(use.pickedUpLocal).toBe("08:30")
  })

  it("an evening with no long gap reports nothing rather than a fake bedtime", async () => {
    db.events = [
      at("2026-09-23", "21:00"),
      at("2026-09-23", "22:30"),
      at("2026-09-23", "23:50"),
    ]
    const use = await phoneNightUse("u1", "2026-09-24", TZ)
    expect(use.phoneDownAt).toBeNull()
    expect(use.pickedUpLocal).toBeNull()
    expect(MIN_NIGHT_GAP_MINUTES).toBe(180)
  })

  it("evening lux is the median of what was sampled, absent when nothing was", async () => {
    db.ambient = [{ lux: 5 }, { lux: 180 }, { lux: 12 }, { lux: null }]
    const use = await phoneNightUse("u1", "2026-09-24", TZ)
    expect(use.eveningLux).toBe(12)
    db.ambient = []
    const none = await phoneNightUse("u1", "2026-09-24", TZ)
    expect(none.eveningLux).toBeNull()
  })
})

describe("the brief and the chat tool read the same definition", () => {
  const stripped = (f: string) =>
    readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

  it("the brief consults phoneNightUse and labels it a clue, not sleep", () => {
    const brief = stripped("src/app/api/briefing/route.ts")
    expect(brief).toMatch(/phoneNightUse\(/)
    expect(brief).toMatch(/not when the user slept|never quote it as sleep/)
  })

  it("the MCP tool exists and goes through the shared library", () => {
    const mcp = stripped("src/app/api/mcp/route.ts")
    expect(mcp).toContain('"get_phone_day"')
    expect(mcp).toMatch(/phoneDaySummary\(/)
  })

  it("Emergy's own chat has the tool too, through the same library", () => {
    // The connector had it and the in-app chat did not, so "ask Emergy" and
    // "ask the connector" gave different answers about the same phone.
    const chat = stripped("src/lib/claude.ts")
    expect(chat).toContain('"get_phone_day"')
    expect(chat).toMatch(/phoneDaySummary\(/)
  })

  it("the chat's screen-time context cannot serve July as \"last 7 days\"", () => {
    // screenTimeLog.findMany took the 7 newest rows whatever their age, and
    // the prompt headed them "Screen time (last 7 days)" — so a table whose
    // last import was July answered as if it were this week.
    const chat = stripped("src/lib/claude.ts")
    const q = chat.indexOf("prisma.screenTimeLog.findMany")
    expect(q).toBeGreaterThan(-1)
    const call = chat.slice(q, q + 400)
    expect(
      /date: ?\{ ?gte/.test(call),
      "The screen-time query has no date floor: rows from months ago are presented as the last 7 days.",
    ).toBe(true)
  })
})
