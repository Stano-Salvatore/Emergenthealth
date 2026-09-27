import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"

// The phone's background location service posts its queued points with the
// widget key, and treats 401 as "this key is dead": it deletes the batch and
// shows "Not linked — open the app once to relink". The key lookup caught its
// own database error and returned "no such key", so a cold or broken Neon
// connection on the first POST after two hours offline answered 401 — and
// ~150 location points were deleted for good. A lookup that failed is not a
// key that is wrong; it is 503, which the service keeps the batch for.

const db = vi.hoisted(() => ({ rows: [] as { userId: string }[], fail: false }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: () => db.fail ? Promise.reject(new Error("WebSocket was closed")) : Promise.resolve(db.rows),
  },
}))

import { widgetKeyUser } from "@/lib/widget-key"

beforeEach(() => { db.rows = []; db.fail = false })

describe("widgetKeyUser", () => {
  it("finds the user a key belongs to", async () => {
    db.rows = [{ userId: "u1" }]
    expect(await widgetKeyUser("k")).toEqual({ ok: true, userId: "u1" })
  })

  it("answers 401 for a key nobody has", async () => {
    expect(await widgetKeyUser("k")).toMatchObject({ ok: false, status: 401 })
  })

  it("answers 401 for no key at all", async () => {
    expect(await widgetKeyUser("")).toMatchObject({ ok: false, status: 401 })
  })

  it("answers 503, not 401, when the lookup itself failed", async () => {
    db.fail = true
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await widgetKeyUser("k")).toMatchObject({ ok: false, status: 503 })
  })
})

describe("every widget route uses it", () => {
  for (const r of ["location", "log", "reminders", "today", "habits"]) {
    it(`widget/${r}`, () => {
      const src = readFileSync(`src/app/api/widget/${r}/route.ts`, "utf8")
      expect(src).toMatch(/widgetKeyUser\(/)
      expect(src, "a private copy of the lookup that turns a DB error into 401").not.toMatch(/function resolveUserByApiKey/)
    })
  }
})
