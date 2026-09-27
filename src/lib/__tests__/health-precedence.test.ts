import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, existsSync } from "node:fs"
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

  it("holds the columns Health Connect actually sends: HRV, SpO2, total kcal, the sleep window", () => {
    // These used to fall outside the rule, so the hourly sync replaced the
    // ring's night HRV with a day average of phone samples.
    const ring = {
      ringAt: new Date(), hrv: 48, spo2: 97.1, totalCalories: 2310, sedentaryTime: 480,
      sleepDuration: 410, sleepStart: new Date("2026-09-25T23:10:00Z"), sleepEnd: new Date("2026-09-26T06:40:00Z"),
    }
    const phone = {
      hrv: 39, spo2: 95, totalCalories: 1900,
      sleepStart: new Date("2026-09-25T22:50:00Z"), sleepEnd: new Date("2026-09-26T06:40:00Z"),
    }
    expect(phoneFieldsRespectingRing(ring, phone)).toEqual({})
  })

  it("does not stitch a phone night onto a ring night", () => {
    // The ring measured the night but sent no stages; Health Connect's stages
    // come from a different session and would not add up to the ring's total.
    const ring = { ringAt: new Date(), sleepDuration: 410, deepSleep: null, remSleep: null, sleepStart: null }
    const phone = { deepSleep: 80, remSleep: 95, sleepStart: new Date("2026-09-25T22:50:00Z"), steps: 6200 }
    expect(phoneFieldsRespectingRing(ring, phone)).toEqual({ steps: 6200 })
  })

  it("fills a whole night the ring did not measure", () => {
    const ring = { ringAt: new Date(), sleepDuration: null, deepSleep: null, steps: 9800, sedentaryTime: 510 }
    expect(phoneFieldsRespectingRing(ring, { sleepDuration: 465, deepSleep: 70, steps: 6200 }))
      .toEqual({ sleepDuration: 465, deepSleep: 70 })
  })

  it("holds the day's activity only when the ring's activity document is on the row", () => {
    // An unworn day: oura-sync set ringAt but stored no activity, so the
    // steps there are the phone's earlier count and the phone may raise them.
    const unworn = { ringAt: new Date(), steps: 1400, activeMinutes: 5, activityScore: null, sedentaryTime: null }
    expect(phoneFieldsRespectingRing(unworn, { steps: 6200, activeMinutes: 31 })).toEqual({ steps: 6200, activeMinutes: 31 })
    const worn = { ...unworn, steps: 9800, sedentaryTime: 510 }
    expect(phoneFieldsRespectingRing(worn, { steps: 6200, activeMinutes: 31 })).toEqual({})
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

  // The hourly writer is /api/sync/health-connect (HealthConnectAutoSync).
  // This guard used to sit on /api/sync/health alone — the manual Log Day
  // form — and passed while the real writer overwrote 30 ring days an hour.
  // PRECEDENCE_SELECT is typed to name every shared column, so a route that
  // reads through it cannot leave one out and have the helper see it as null.
  for (const file of ["src/app/api/sync/health-connect/route.ts", "src/app/api/sync/health/route.ts"]) {
    it(`${file} reads the ring's columns and writes only what the helper allows`, () => {
      const route = strip(file)
      const read = route.search(/select: (\{[^}]*\.\.\.)?PRECEDENCE_SELECT\b/)
      const allow = route.indexOf("phoneFieldsRespectingRing(")
      const upsert = route.indexOf("healthLog.upsert(")
      expect(read, "the route no longer reads the ring's columns").toBeGreaterThan(-1)
      expect(allow, "the route no longer consults lib/health-precedence").toBeGreaterThan(-1)
      expect(allow < upsert, "the precedence check must come before the upsert").toBe(true)
      expect(route, "the update branch must spread `allowed`, not the raw incoming fields")
        .toMatch(/update: \{\s*\.\.\.allowed/)
    })
  }

  it("no sync route writes HealthLog around the rule", () => {
    const dir = "src/app/api/sync"
    for (const sub of readdirSync(dir)) {
      const file = `${dir}/${sub}/route.ts`
      if (!existsSync(file)) continue
      const route = strip(file)
      if (!/healthLog\.(upsert|update|updateMany|create)\(/.test(route)) continue
      expect(route, `${file} writes HealthLog without lib/health-precedence`).toContain("phoneFieldsRespectingRing(")
    }
  })
})
