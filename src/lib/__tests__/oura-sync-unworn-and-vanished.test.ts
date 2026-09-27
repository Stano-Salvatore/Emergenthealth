import { describe, it, expect, vi, beforeEach } from "vitest"

// Two things the ring sync stored that were never true.
//
// A day the ring spent on its charger comes back from Oura as a document full
// of zeros — 0 steps, 0 active kcal, 0 km — not as a missing day. The sync
// stored those zeros as measurements, so the daily score had a Movement
// component to score, the anomaly scan counted a "low steps" day, the brief
// narrated a streak of them, and Health Connect could never fill the day
// because the ring had "spoken" with its 0.
//
// And a drink tag deleted or relabelled in the Oura app stayed in IntakeLog
// and CaffeineLog for good: the sync only ever upserted, the Intake page
// tells the user to fix ring tags in the Oura app, and the fix never arrived.
// A mis-tagged 21:30 coffee kept counting towards tonight's caffeine.

const db = vi.hoisted(() => ({
  activity: [] as Record<string, unknown>[],
  tags: [] as Record<string, unknown>[],
  tagsComplete: true,
  storedTags: [] as { id: string; day: string }[],
  upserts: [] as { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }[],
  healthUpdateMany: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  intakeUpserts: [] as { where: { id: string }; update: Record<string, unknown> }[],
  caffeineUpserts: [] as { where: { id: string } }[],
  intakeDeletes: [] as string[],
  caffeineDeletes: [] as string[],
  tagDeletes: [] as string[],
  tagFindWhere: null as unknown,
}))

const idsIn = (where: { id?: { in?: string[] } | string }): string[] =>
  typeof where.id === "string" ? [where.id] : (where.id?.in ?? [])

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ouraToken: { findUnique: async () => ({ userId: "u1", scope: "daily tag" }) },
    healthLog: {
      upsert: async (args: { where: unknown; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        db.upserts.push(args); return {}
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        db.healthUpdateMany.push(args); return { count: 1 }
      },
    },
    ouraTag: {
      findMany: async (args: { where: unknown }) => { db.tagFindWhere = args.where; return db.storedTags },
      deleteMany: async ({ where }: { where: { id?: { in?: string[] } } }) => {
        db.tagDeletes.push(...idsIn(where)); return { count: 0 }
      },
    },
    intakeLog: {
      upsert: async (args: { where: { id: string }; update: Record<string, unknown> }) => { db.intakeUpserts.push(args); return {} },
      deleteMany: async ({ where }: { where: { id?: { in?: string[] } } }) => {
        db.intakeDeletes.push(...idsIn(where)); return { count: 0 }
      },
    },
    caffeineLog: {
      upsert: async (args: { where: { id: string } }) => { db.caffeineUpserts.push(args); return {} },
      deleteMany: async ({ where }: { where: { id?: { in?: string[] } } }) => {
        db.caffeineDeletes.push(...idsIn(where)); return { count: 0 }
      },
    },
    $executeRaw: async () => 1,
    $queryRaw: async () => [],
  },
}))
vi.mock("@/lib/user-timezone", () => ({ userToday: async () => "2026-09-26" }))
vi.mock("@/lib/oura", () => ({
  getDailySleep: async () => [],
  getDailySleepScores: async () => [],
  getDailyActivity: async () => db.activity,
  getDailyReadiness: async () => [],
  getDailySpo2: async () => [],
  getDailyStress: async () => [],
  getDailyCardiovascularAge: async () => [],
  getVo2Max: async () => [],
  getDailyResilience: async () => [],
  getOuraTags: async () => ({ tags: db.tags, complete: db.tagsComplete }),
}))

import { syncOuraForUser, isUnwornDay } from "@/lib/oura-sync"

const worn = {
  date: "2026-09-25", steps: 7400, activeCalories: 310, totalCalories: 2280, distanceKm: 5.6,
  activeMinutes: 42, activityScore: 81, sedentaryTimeSeconds: 30000, nonWearSeconds: 1800,
}
const charger = {
  date: "2026-09-24", steps: 0, activeCalories: 0, totalCalories: 1650, distanceKm: 0,
  activeMinutes: 0, activityScore: null, sedentaryTimeSeconds: 0, nonWearSeconds: 86400,
}
const tag = (id: string, tagName: string, day = "2026-09-25") =>
  ({ id, day, timestamp: `${day}T19:30:00Z`, tagName, comment: null, tags: [], uuid: null })

const rowFor = (date: string) =>
  db.upserts.find(u => (u.where as { userId_date: { date: Date } }).userId_date.date.toISOString().startsWith(date))!

beforeEach(() => {
  db.activity = []; db.tags = []; db.tagsComplete = true; db.storedTags = []
  db.upserts = []; db.healthUpdateMany = []; db.intakeUpserts = []; db.caffeineUpserts = []
  db.intakeDeletes = []; db.caffeineDeletes = []; db.tagDeletes = []; db.tagFindWhere = null
})

describe("a day the ring was not worn", () => {
  it("is recognised by zero steps or a day of non-wear", () => {
    expect(isUnwornDay(charger)).toBe(true)
    expect(isUnwornDay({ ...charger, steps: 350 })).toBe(true)
    expect(isUnwornDay(worn)).toBe(false)
    expect(isUnwornDay(undefined)).toBe(false)
  })

  it("writes none of the charger's zeros as a measurement", async () => {
    db.activity = [worn, charger]
    const out = await syncOuraForUser("u1")
    expect(out.ok).toBe(true)
    const row = rowFor("2026-09-24")
    for (const col of ["steps", "caloriesBurned", "totalCalories", "distanceKm", "activeMinutes", "sedentaryTime"]) {
      expect(row.create, `${col} stored from an unworn day`).not.toHaveProperty(col)
      expect(row.update, `${col} stored from an unworn day`).not.toHaveProperty(col)
    }
    // The worn day is written as before.
    expect(rowFor("2026-09-25").update).toMatchObject({ steps: 7400, caloriesBurned: 310, activeMinutes: 42 })
  })

  it("clears the zeros an earlier sync already stored, and only those", async () => {
    // The 24 Sept row holds steps 0 from before this fix. Clearing it only
    // where it still holds the ring's own value leaves a Health Connect fill
    // alone; writing a blanket null every sync would wipe it each time.
    db.activity = [charger]
    await syncOuraForUser("u1")
    const steps = db.healthUpdateMany.find(u => "steps" in u.data)
    expect(steps?.where).toMatchObject({ userId: "u1", steps: 0 })
    expect(steps?.data).toEqual({ steps: null })
    expect(db.healthUpdateMany.some(u => "caloriesBurned" in u.data && u.where.caloriesBurned === 0)).toBe(true)
    expect(db.healthUpdateMany.some(u => "distanceKm" in u.data)).toBe(true)
    // A worn day repairs nothing.
    db.healthUpdateMany = []
    db.activity = [worn]
    await syncOuraForUser("u1")
    expect(db.healthUpdateMany).toEqual([])
  })
})

describe("a drink tag gone from the Oura app leaves the app too", () => {
  it("removes a vanished ring tag with its intake and caffeine rows", async () => {
    db.tags = [tag("keep", "Water")]
    db.storedTags = [{ id: "keep", day: "2026-09-25" }, { id: "gone", day: "2026-09-25" }]
    await syncOuraForUser("u1")
    expect(db.tagDeletes).toEqual(["gone"])
    expect(db.intakeDeletes).toContain("oura_gone")
    expect(db.caffeineDeletes).toContain("oura_caf_gone")
    expect(db.intakeDeletes).not.toContain("oura_keep")
  })

  it("never looks at manual doses, and leaves the window's oldest day alone", async () => {
    // A manual_ row is the user's own log and never comes from Oura. The
    // oldest day is left because Oura may file a just-after-midnight tag
    // under the day before; missing from one fetch is not proof it is gone.
    await syncOuraForUser("u1")
    const where = db.tagFindWhere as { id: { not: { startsWith: string } }; day: { gte: string; lte: string } }
    expect(where.id).toEqual({ not: { startsWith: "manual_" } })
    expect(where.day.lte).toBe("2026-09-26")
    expect(where.day.gte > "2026-08-28").toBe(true)
  })

  it("prunes nothing when Oura's answer was cut short", async () => {
    // Pages left unread would read as "deleted" and take real drinks with them.
    db.tagsComplete = false
    db.tags = [tag("keep", "Water")]
    db.storedTags = [{ id: "keep", day: "2026-09-25" }, { id: "gone", day: "2026-09-25" }]
    await syncOuraForUser("u1")
    expect(db.tagDeletes).toEqual([])
    expect(db.intakeDeletes).not.toContain("oura_gone")
  })

  it("a coffee relabelled as water drops its caffeine and its old name", async () => {
    db.tags = [tag("t1", "Water")]
    db.storedTags = [{ id: "t1", day: "2026-09-25" }]
    await syncOuraForUser("u1")
    expect(db.caffeineDeletes).toContain("oura_caf_t1")
    const intake = db.intakeUpserts.find(u => u.where.id === "oura_t1")
    expect(intake?.update).toMatchObject({ note: "Water (Oura)" })
  })

  it("a drink relabelled as something else leaves IntakeLog", async () => {
    db.tags = [tag("t2", "Headache")]
    db.storedTags = [{ id: "t2", day: "2026-09-25" }]
    await syncOuraForUser("u1")
    expect(db.intakeDeletes).toContain("oura_t2")
    expect(db.caffeineDeletes).toContain("oura_caf_t2")
  })

  it("a coffee still tagged coffee keeps its caffeine", async () => {
    db.tags = [tag("t3", "Coffee")]
    db.storedTags = [{ id: "t3", day: "2026-09-25" }]
    await syncOuraForUser("u1")
    expect(db.caffeineUpserts.map(u => u.where.id)).toContain("oura_caf_t3")
    expect(db.caffeineDeletes).not.toContain("oura_caf_t3")
    expect(db.intakeDeletes).not.toContain("oura_t3")
  })
})
