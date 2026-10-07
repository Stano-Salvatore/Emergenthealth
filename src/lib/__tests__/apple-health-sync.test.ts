import { describe, it, expect, vi, beforeEach } from "vitest"
import { createHash } from "node:crypto"
import { NextRequest } from "next/server"

// An iPhone Shortcut posts Apple Health data to /api/sync/apple-health with
// the account's key. Only the key's hash is stored, the key is shown once,
// and the ring's readings still win where it has them.

const db = vi.hoisted(() => ({
  keys: [] as { userId: string; tokenHash: string; hint: string; lastUsedAt?: Date | null; createdAt: Date }[],
  upserts: [] as { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }[],
  existing: null as Record<string, unknown> | null,
  prefs: new Map<string, string>(),
  ring: false,
  points: [] as unknown[],
}))

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/user-timezone", () => ({ userToday: async () => "2026-10-06", getUserTimezone: async () => "Europe/Bratislava" }))
vi.mock("@/lib/local-date", async orig => ({ ...(await orig<typeof import("@/lib/local-date")>()), localDateStr: (tz: string, at?: Date) => at ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at) : "2026-10-06" }))
vi.mock("@/lib/location-ingest", () => ({
  ingestLocationPoints: async (_u: string, pts: unknown[]) => { db.points.push(...pts); return { inserted: pts.length, received: pts.length, checkIns: 0 } },
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appleHealthKey: {
      findUnique: async ({ where }: { where: { tokenHash?: string; userId?: string } }) =>
        db.keys.find(k => (where.tokenHash ? k.tokenHash === where.tokenHash : k.userId === where.userId)) ?? null,
      upsert: async ({ create }: { create: (typeof db.keys)[number] }) => {
        db.keys = db.keys.filter(k => k.userId !== create.userId)
        db.keys.push({ ...create, createdAt: new Date() })
        return create
      },
      update: async () => ({}),
      deleteMany: async () => { const n = db.keys.length; db.keys = []; return { count: n } },
    },
    healthLog: {
      findUnique: async () => db.existing,
      upsert: async (a: (typeof db.upserts)[number]) => { db.upserts.push(a); return {} },
    },
    ouraToken: { findUnique: async () => (db.ring ? { userId: "u1" } : null) },
    userPreference: {
      deleteMany: async ({ where }: { where: { key: { in: string[] } } }) => { for (const k of where.key.in) db.prefs.delete(k); return { count: 1 } },
      upsert: async ({ create }: { create: { key: string; value: string } }) => { db.prefs.set(create.key, create.value); return {} },
      findUnique: async ({ where }: { where: { userId_key: { key: string } } }) => {
        const v = db.prefs.get(where.userId_key.key)
        return v ? { value: v } : null
      },
    },
  },
}))

import { POST as SYNC } from "@/app/api/sync/apple-health/route"
import { GET as KEY_GET, POST as KEY_POST, DELETE as KEY_DELETE } from "@/app/api/apple-health/key/route"

const post = (body: unknown, key?: string) => SYNC(new NextRequest("http://x/api/sync/apple-health", {
  method: "POST",
  body: JSON.stringify(body),
  headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
}))

beforeEach(() => { db.keys = []; db.upserts = []; db.existing = null; db.prefs.clear(); db.ring = false; db.points = [] })

async function newKey(): Promise<string> {
  const res = await KEY_POST()
  return (await res.json()).key as string
}

describe("the key", () => {
  it("is shown once, and only its hash is kept", async () => {
    const key = await newKey()
    expect(key).toMatch(/^ah_[A-Za-z0-9_-]{30,}$/)
    expect(db.keys[0].tokenHash).toBe(createHash("sha256").update(key).digest("hex"))
    expect(JSON.stringify(db.keys)).not.toContain(key)
    const status = await (await KEY_GET()).json()
    expect(JSON.stringify(status)).not.toContain(key)
    expect(status.hint).toBe(key.slice(-4))
  })

  it("a new key replaces the old one, and revoking stops it", async () => {
    const first = await newKey()
    const second = await newKey()
    expect((await post({ steps: 10 }, first)).status).toBe(401)
    expect((await post({ steps: 10 }, second)).status).toBe(200)
    await KEY_DELETE()
    expect((await post({ steps: 10 }, second)).status).toBe(401)
  })
})

describe("the sync", () => {
  it("no key, or a wrong one, is refused", async () => {
    expect((await post({ steps: 10 })).status).toBe(401)
    expect((await post({ steps: 10 }, "ah_nope")).status).toBe(401)
  })

  it("writes the day and says what it saved", async () => {
    const key = await newKey()
    const res = await post({
      steps: "8 123", restingHR: 58,
      sleepStarts: "2026-10-05T23:10:00+02:00", sleepEnds: "2026-10-06T06:40:00+02:00",
    }, key)
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.date).toBe("2026-10-06")
    expect(out.saved).toMatchObject({ steps: 8123, restingHR: 58, sleepDuration: 450 })
    expect(db.upserts[0].create).toMatchObject({ steps: 8123, restingHR: 58, sleepDuration: 450 })
    expect(JSON.parse(db.prefs.get("apple_health_last_sync")!)).toMatchObject({ date: "2026-10-06" })
  })

  it("nothing readable is a 422 naming what came, and nothing is written", async () => {
    const key = await newKey()
    const res = await post({ steps: 0, sleepStarts: "6. 10. 2026 o 23:14", sleepEnds: "x" }, key)
    expect(res.status).toBe(422)
    const out = await res.json()
    expect(out.ignored).toContain("sleep")
    expect(out.error).toMatch(/ISO 8601/)
    expect(db.upserts).toHaveLength(0)
  })

  it("a failed run leaves its reason for the card to show", async () => {
    const key = await newKey()
    await post({ steps: 0 }, key)
    const err = JSON.parse(db.prefs.get("apple_health_last_error")!)
    expect(err.error).toMatch(/Turn On All|allowed to read Health/)
  })

  it("with an Oura ring connected, Apple's HRV (SDNN) stays out of the ring's RMSSD series", async () => {
    const key = await newKey()
    db.ring = true
    const out = await (await post({ steps: 5000, hrv: 40 }, key)).json()
    expect(db.upserts[0].create.hrv).toBeUndefined()
    expect(out.saved.hrv).toBeUndefined()
  })

  it("disconnecting forgets what was received, so the card doesn't still look connected", async () => {
    const key = await newKey()
    await post({ steps: 10 }, key)
    await KEY_DELETE()
    expect(db.prefs.has("apple_health_last_sync")).toBe(false)
  })

  it("the ring's night stands where it has one", async () => {
    const key = await newKey()
    db.existing = { ringAt: new Date(), sleepDuration: 410, steps: null }
    await post({ steps: 5000, sleepMinutes: 460 }, key)
    expect(db.upserts[0].update.sleepDuration).toBeUndefined()
    expect(db.upserts[0].update.steps).toBe(5000)
  })

  it("a body that isn't JSON is a 400", async () => {
    const key = await newKey()
    const res = await SYNC(new NextRequest("http://x/api/sync/apple-health", {
      method: "POST", body: "not json", headers: { authorization: `Bearer ${key}` },
    }))
    expect(res.status).toBe(400)
  })
})

// The shortcut can also say where the phone is, each time it runs: on an
// iPhone there is no background tracking, and this is what place patterns
// get instead. It lands as the phone's own points do (lib/location-ingest).
describe("where the phone is", () => {
  it("a run with coordinates stores a point, decimal commas and all", async () => {
    const key = await newKey()
    const res = await post({ steps: 1200, lat: "48,1486", lon: "17,1077" }, key)
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.location).toBe(true)
    expect(db.points).toHaveLength(1)
    expect(db.points[0]).toMatchObject({ lat: 48.1486, lng: 17.1077 })
  })

  it("a run with only a location is a good run, not 'nothing readable'", async () => {
    const key = await newKey()
    const res = await post({ lat: 48.1486, lon: 17.1077, steps: 0 }, key)
    expect(res.status).toBe(200)
    expect(db.upserts).toHaveLength(0)
    expect(JSON.parse(db.prefs.get("apple_health_last_sync")!).location).toBe(true)
  })

  it("coordinates off the globe, or only half of them, are named and not stored", async () => {
    const key = await newKey()
    const out = await (await post({ steps: 100, lat: 95, lon: 17 }, key)).json()
    expect(out.ignored).toContain("location")
    const half = await (await post({ steps: 100, lat: 48.1 }, key)).json()
    expect(half.ignored).toContain("location")
    expect(db.points).toHaveLength(0)
  })
})
