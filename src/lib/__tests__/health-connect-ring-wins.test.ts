import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import type { NextRequest } from "next/server"

// "The ring wins" was wired into the wrong route. HealthConnectAutoSync posts
// 30 days to /api/sync/health-connect every hour the app is open, and that
// route upserted everything it was sent: a ring night of 410 min asleep became
// Health Connect's 460 min in bed, the ring's night HRV became a day average
// of phone samples, the ring's steps became the pedometer's — across the whole
// window, until the next Oura sync flipped them back. Whichever ran last won.
//
// And the manual Log Day form, where the rule did live, dropped the fields the
// ring held and still answered 200, so the dialog closed as if it had saved.

const db = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  upserts: [] as { where: { userId_date: { date: Date } }; create: Record<string, unknown>; update: Record<string, unknown> }[],
}))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: {
      findMany: async () => db.rows,
      findUnique: async ({ where }: { where: { userId_date: { date: Date } } }) =>
        db.rows.find(r => (r.date as Date).getTime() === where.userId_date.date.getTime()) ?? null,
      upsert: async (args: (typeof db.upserts)[number]) => { db.upserts.push(args); return { id: "x" } },
    },
    userPreference: { upsert: async () => ({}) },
  },
}))

import { POST as healthConnect } from "@/app/api/sync/health-connect/route"
import { POST as manual } from "@/app/api/sync/health/route"

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const at = (d: string) => new Date(d + "T00:00:00.000Z")
const upsertFor = (d: string) => db.upserts.find(u => u.where.userId_date.date.getTime() === at(d).getTime())!

const ringNight = {
  date: at("2026-09-26"), ringAt: new Date("2026-09-26T10:00:00Z"),
  sleepDuration: 410, deepSleep: 70, remSleep: 90, lightSleep: 250,
  sleepStart: new Date("2026-09-25T23:44:00Z"), sleepEnd: new Date("2026-09-26T07:27:00Z"),
  steps: 9800, caloriesBurned: 420, totalCalories: 2400, activeMinutes: 55,
  restingHR: 52, hrv: 48, spo2: 97.2,
}

beforeEach(() => { db.rows = []; db.upserts = [] })

describe("/api/sync/health-connect", () => {
  const phoneDay = {
    date: "2026-09-26", steps: 6200, sleepDurationMin: 460, deepSleepMin: 60, remSleepMin: 80, lightSleepMin: 300,
    sleepStart: "2026-09-25T23:20:00Z", sleepEnd: "2026-09-26T07:27:00Z",
    restingHR: 57, hrv: 39, spo2: 95, weight: 81.4, caloriesBurned: 300, totalCalories: 2100, activeMinutes: 30,
  }

  it("leaves every column the ring wrote alone, and still takes what the ring never measures", async () => {
    db.rows = [ringNight]
    const res = await healthConnect(req({ days: [phoneDay] }))
    expect(res.status).toBe(200)
    const { update } = upsertFor("2026-09-26")
    for (const col of [
      "steps", "sleepDuration", "deepSleep", "remSleep", "lightSleep", "sleepStart", "sleepEnd",
      "restingHR", "hrv", "spo2", "caloriesBurned", "totalCalories", "activeMinutes",
    ]) {
      expect(update, `Health Connect overwrote the ring's ${col}`).not.toHaveProperty(col)
    }
    expect(update.weight).toBe(81.4)
    expect(update.syncedAt).toBeInstanceOf(Date)
  })

  it("fills what the ring left blank", async () => {
    db.rows = [{ ...ringNight, steps: null, hrv: null }]
    await healthConnect(req({ days: [phoneDay] }))
    expect(upsertFor("2026-09-26").update).toMatchObject({ steps: 6200, hrv: 39 })
  })

  it("writes everything on a day the ring never touched", async () => {
    db.rows = [{ date: at("2026-09-25"), ringAt: null, steps: 4000 }]
    await healthConnect(req({ days: [{ ...phoneDay, date: "2026-09-25" }, { ...phoneDay, date: "2026-09-24" }] }))
    expect(upsertFor("2026-09-25").update).toMatchObject({ steps: 6200, sleepDuration: 460, hrv: 39 })
    expect(upsertFor("2026-09-24").create).toMatchObject({ userId: "u1", steps: 6200, sleepDuration: 460 })
  })
})

describe("/api/sync/health (Log Day)", () => {
  it("says which fields the ring kept instead of pretending it saved them", async () => {
    db.rows = [{ ...ringNight, restingHR: null }]
    const res = await manual(req({ date: "2026-09-26", sleepHours: 8, steps: 12000, restingHR: 58 }))
    const body = await res.json()
    expect(body.kept).toEqual(expect.arrayContaining(["sleepDuration", "steps"]))
    expect(body.written).toEqual(["restingHR"])
    expect(upsertFor("2026-09-26").update).not.toHaveProperty("steps")
  })

  it("reports nothing kept on a day the ring has not written", async () => {
    const res = await manual(req({ date: "2026-09-20", steps: 12000 }))
    const body = await res.json()
    expect(body.kept).toEqual([])
    expect(body.written).toEqual(["steps"])
  })

  it("the form stays open and says what the ring kept, rather than closing as if it saved", () => {
    const form = readFileSync("src/components/health/HealthEntryForm.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
    expect(form).toMatch(/data\?\.kept/)
    expect(form).toMatch(/if \(kept\.length === 0\) \{\s*setOpen\(false\)/)
  })
})
