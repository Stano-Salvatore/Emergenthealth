import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"
import { readFileSync } from "node:fs"

// The phone posts 30 days an hour. The route took any number of days and
// fired every upsert at once — one request of thousands of days held the
// shared database's connections for every user — and wrote whatever value
// came: a string, a negative step count, a sleep start that isn't a date
// (a 500 from Prisma, and the whole sync lost with it).

const db = vi.hoisted(() => ({ upserts: [] as { create: Record<string, unknown> }[], inFlight: 0, peak: 0 }))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: {
      findMany: async () => [],
      findUnique: async () => null,
      upsert: async (args: { create: Record<string, unknown> }) => {
        db.inFlight++
        db.peak = Math.max(db.peak, db.inFlight)
        await new Promise(r => setTimeout(r, 1))
        db.inFlight--
        db.upserts.push(args)
        return { id: "x" }
      },
    },
    userPreference: { upsert: async () => ({}) },
  },
}))

import { POST } from "@/app/api/sync/health-connect/route"

const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest
const day = (i: number) => new Date(Date.UTC(2026, 9, 3) - i * 86_400_000).toISOString().slice(0, 10)

beforeEach(() => { db.upserts = []; db.inFlight = 0; db.peak = 0 })

describe("Health Connect sync takes a phone's worth of days, sanely", () => {
  it("keeps the most recent days past the cap, and never writes them all at once", async () => {
    const res = await POST(req({ days: Array.from({ length: 5000 }, (_, i) => ({ date: day(i), steps: 1000 })) }))
    expect(res.status).toBe(200)
    expect(db.upserts.length).toBeLessThanOrEqual(62)
    expect(db.upserts.map(u => (u.create.date as Date).toISOString().slice(0, 10))).toContain(day(0))
    expect(db.peak).toBeLessThanOrEqual(10)
  })

  it("drops a value that isn't a plausible number or date, and keeps the rest of the day", async () => {
    const res = await POST(req({ days: [{
      date: day(0), steps: "lots", sleepDurationMin: -5, weight: 1e308, activeMinutes: 42,
      sleepStart: "not a date", sleepEnd: "2026-10-03T06:30:00.000Z",
    }] }))
    expect(res.status).toBe(200)
    const c = db.upserts[0].create
    expect(c.steps).toBeUndefined()
    expect(c.sleepDuration).toBeUndefined()
    expect(c.weight).toBeUndefined()
    expect(c.sleepStart).toBeUndefined()
    expect(c.activeMinutes).toBe(42)
    expect((c.sleepEnd as Date).toISOString()).toBe("2026-10-03T06:30:00.000Z")
  })

  it("a day with no value left to write makes no row", async () => {
    const res = await POST(req({ days: [{ date: day(0), steps: "lots" }, { date: day(1), steps: 10 }] }))
    expect(res.status).toBe(200)
    expect(db.upserts).toHaveLength(1)
  })

  it("a date that only looks like one is skipped, not a crash", async () => {
    const res = await POST(req({ days: [{ date: "2026-13-45", steps: 10 }, { date: day(0), steps: 10 }] }))
    expect(res.status).toBe(200)
    expect(db.upserts).toHaveLength(1)
  })
})

describe("the Log Day form's route says what it can't save instead of a 500", () => {
  it("a date that isn't one is a 400 naming it", async () => {
    const { POST: manual } = await import("@/app/api/sync/health/route")
    const res = await manual(req({ date: "yesterday-ish", steps: 10 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/date/i)
  })

  it("a value out of range is a 400 naming the field, and nothing is written", async () => {
    const { POST: manual } = await import("@/app/api/sync/health/route")
    const res = await manual(req({ date: day(0), steps: -40, restingHR: 58 }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/steps/i)
    expect(db.upserts).toHaveLength(0)
  })

  it("workouts must be a short list", async () => {
    const { POST: manual } = await import("@/app/api/sync/health/route")
    const res = await manual(req({ date: day(0), workouts: "x".repeat(100_000) }))
    expect(res.status).toBe(400)
  })

  it("and the form shows a refusal rather than sitting there", () => {
    const src = readFileSync("src/components/health/HealthEntryForm.tsx", "utf8")
    expect(src).toMatch(/if \(!res\.ok\)/)
  })
})

describe("weight and tracked points hold real values", () => {
  it("a weight no person has, or a date that isn't one, is refused", async () => {
    vi.doMock("@/lib/user-timezone", () => ({ userToday: async () => "2026-10-03" }))
    const { POST: weight } = await import("@/app/api/weight/route")
    const asReq = (b: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(b) })
    expect((await weight(asReq({ weight: 1e308 }))).status).toBe(400)
    expect((await weight(asReq({ weight: -3 }))).status).toBe(400)
    expect((await weight(asReq({ weight: 72.4, date: "soon" }))).status).toBe(400)
    expect(db.upserts).toHaveLength(0)
  })

  it("a tracked point without numeric coordinates is not stored", () => {
    const src = readFileSync("src/app/api/location/track/route.ts", "utf8")
    expect(src).toMatch(/typeof body\.lat !== "number"/)
  })
})
