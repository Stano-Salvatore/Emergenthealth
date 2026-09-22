import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { phoneFieldsRespectingRing } from "@/lib/health-precedence"

// Two writers, one row. The rule is the ring wins where it speaks and the
// phone fills the rest; this holds the rule in the pure helper and holds
// both writers to using it.

const strip = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

describe("phoneFieldsRespectingRing", () => {
  const incoming = { sleepDuration: 400, steps: 9100, restingHR: 52, activeMinutes: undefined }

  it("writes everything when no row exists", () => {
    expect(phoneFieldsRespectingRing(null, incoming)).toEqual({ sleepDuration: 400, steps: 9100, restingHR: 52 })
  })

  it("writes everything when the ring has never written the row", () => {
    const existing = { ringAt: null, sleepDuration: 440, steps: null, restingHR: 55 }
    expect(phoneFieldsRespectingRing(existing, incoming)).toEqual({ sleepDuration: 400, steps: 9100, restingHR: 52 })
  })

  it("on a ring row, fills only what the ring left null", () => {
    const existing = { ringAt: new Date("2026-09-22T08:00:00Z"), sleepDuration: 440, steps: null, restingHR: 55 }
    expect(phoneFieldsRespectingRing(existing, incoming)).toEqual({ steps: 9100 })
  })

  it("never turns \"not sent\" into null", () => {
    const existing = { ringAt: new Date(), sleepDuration: null, activeMinutes: null }
    expect(phoneFieldsRespectingRing(existing, { activeMinutes: undefined, sleepDuration: undefined })).toEqual({})
  })
})

describe("both writers use the rule", () => {
  it("the ring marks the rows it writes", () => {
    expect(strip("src/lib/oura-sync.ts"), "oura-sync no longer sets ringAt; Health Connect will overwrite ring nights again")
      .toMatch(/ringAt: new Date\(\)/)
  })

  it("Health Connect reads the row and writes only what the helper allows", () => {
    const route = strip("src/app/api/sync/health/route.ts")
    const read = route.indexOf("ringAt: true")
    const allow = route.indexOf("phoneFieldsRespectingRing(")
    const upsert = route.indexOf("healthLog.upsert(")
    expect(read, "the route no longer reads ringAt").toBeGreaterThan(-1)
    expect(allow, "the route no longer consults lib/health-precedence").toBeGreaterThan(-1)
    expect(allow < upsert, "the precedence check must come before the upsert").toBe(true)
    expect(route, "the update branch must spread `allowed`, not the raw incoming fields")
      .toMatch(/update: \{\s*\.\.\.allowed/)
  })
})
