import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// 3.4.2 taught the phone to describe a night (pickups after 22:00, the quiet
// gap), and since then the brief and the chat could SAY it — but nothing ever
// asked whether it MATTERS. "Your worst nights follow phone use in bed" is a
// question only the correlation engine can answer, and the series it needed
// was sitting one import away.
//
// The rules this pins: the per-night series comes from ONE PhoneEvent query
// for the whole window (a per-night query would be ~90 round trips inside a
// cron); a night with no qualifying quiet gap is ABSENT, never a zero (a
// phone left in another room says nothing about phone use in bed); and the
// cards gate on enough covered nights before speaking.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("phoneNightSeries", () => {
  const src = strip("src/lib/phone-day.ts")
  const open = src.indexOf("export async function phoneNightSeries")
  const body = open === -1 ? "" : src.slice(open, src.indexOf("\nexport", open + 1))

  it("exists and queries PhoneEvent exactly once for the whole span", () => {
    expect(open).toBeGreaterThan(-1)
    expect(body.match(/prisma\.phoneEvent\.findMany/g)?.length).toBe(1)
  })
  it("a night without a qualifying gap is absent, not zero", () => {
    expect(body).toMatch(/MIN_NIGHT_GAP_MINUTES/)
    expect(body).toMatch(/continue/)
  })
})

describe("the engine asks whether phone-in-bed matters", () => {
  const cor = strip("src/lib/correlations.ts")

  it("carries the night's pickups as a day fact", () => {
    expect(cor).toMatch(/nightPickups\?: number/)
    expect(cor).toMatch(/phoneNightSeries\(/)
  })
  it("runs the sleep and the morning-energy card", () => {
    expect(cor).toMatch(/id: "phone_pickups_sleep"/)
    expect(cor).toMatch(/id: "phone_pickups_energy"/)
  })
  it("gates on enough covered nights before speaking", () => {
    const at = cor.indexOf("phone_pickups_sleep")
    const before = cor.slice(Math.max(0, at - 2000), at)
    expect(before).toMatch(/length >= 10/)
  })
})
