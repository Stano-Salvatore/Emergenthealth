import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// A routine stores habit ids, and completing it writes a completion for each.
// The ids came from the request body unchecked, so anyone holding another
// account's habit id could file it in their own routine and tick that habit
// done for its owner — every reader joins completions through the habit, and
// the owner's own un-tick only deletes rows filed under their userId.

const OWN = ["h-own-1", "h-own-2"]
const db = {
  created: null as null | Record<string, unknown>,
  updated: null as null | Record<string, unknown>,
  completions: [] as { habitId: string }[],
  routineHabitIds: [] as string[],
}

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u-b" } }) }))
vi.mock("@/lib/user-timezone", () => ({ userDay: async () => ({ dateColumn: new Date("2026-10-03T00:00:00Z") }) }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    habit: {
      findMany: async ({ where }: { where: { id: { in: string[] }; userId: string } }) =>
        where.userId === "u-b" ? where.id.in.filter(id => OWN.includes(id)).map(id => ({ id })) : [],
    },
    habitRoutine: {
      create: async ({ data }: { data: Record<string, unknown> }) => { db.created = data; return { id: "r1", ...data } },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { db.updated = data; return { count: 1 } },
      findFirst: async () => ({ id: "r1", userId: "u-b", habitIds: db.routineHabitIds }),
    },
    habitCompletion: {
      findMany: async () => [],
      createMany: async ({ data }: { data: { habitId: string }[] }) => { db.completions.push(...data); return { count: data.length } },
    },
    habitSkip: { deleteMany: async () => ({ count: 0 }) },
  },
}))

import { POST, PATCH } from "@/app/api/routines/route"
import { POST as COMPLETE } from "@/app/api/routines/[id]/complete/route"

const req = (method: string, body: unknown) =>
  new NextRequest("http://x/api/routines", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } })

beforeEach(() => { db.created = null; db.updated = null; db.completions = []; db.routineHabitIds = [] })

describe("a routine holds only the user's own habits", () => {
  it("creating one drops another account's habit id", async () => {
    await POST(req("POST", { name: "Morning", habitIds: ["h-own-1", "h-someone-else"] }))
    expect(db.created?.habitIds).toEqual(["h-own-1"])
  })

  it("editing one drops it too", async () => {
    await PATCH(req("PATCH", { id: "r1", habitIds: ["h-someone-else", "h-own-2"] }))
    expect(db.updated?.habitIds).toEqual(["h-own-2"])
  })

  it("completing one already holding a foreign id writes no completion for it", async () => {
    db.routineHabitIds = ["h-own-1", "h-someone-else"]
    await COMPLETE(new NextRequest("http://x", { method: "POST" }), { params: Promise.resolve({ id: "r1" }) })
    expect(db.completions.map(c => c.habitId)).toEqual(["h-own-1"])
  })

  it("a name that isn't text is refused, not stored", async () => {
    const res = await POST(req("POST", { name: { a: 1 }, habitIds: [] }))
    expect(res.status).toBe(400)
    expect(db.created).toBeNull()
  })
})
