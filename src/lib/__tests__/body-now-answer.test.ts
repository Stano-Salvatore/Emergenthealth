import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"

// "Is atarax still in my system?" was answered by a script that only ever
// looked at caffeine and alcohol, so at 08:00 after a 22:00 dose it said
// "Nothing much" — while the app's own reference text says about 70% is still
// on board, and the "In my body" tab showed 71%. The script and the tab now
// read one computation (lib/body-load-now), so they cannot disagree.
//
// A medicine the app has no half-life for used to vanish from both: Stilnox an
// hour ago, no coffee today, and the tab said "Clear right now." Not knowing
// the curve is not the same as knowing it is gone, so it is named instead.
//
// And the scripted caffeine figures ran on the population 5h half-life while
// the card and Emergy used the user's fitted one: 200mg at 14:00 read as 66mg
// at 22:00 in chat and 91mg everywhere else, for someone who clears it in 7h.

const db = {
  caffeine: [] as { caffeineMg: number; loggedAt: Date; compound: string }[],
  intake: [] as { type: string; amountMl: number; note: string | null; loggedAt: Date }[],
  tags: [] as { id: string; tagName: string | null; text: string | null; timestamp: Date; doseAmount: number | null; doseUnit: string | null }[],
  halfLifeH: 5,
  usedDefault: true,
}

type Range = { gte?: Date; lte?: Date }
const inRange = (d: Date, r?: Range) => (!r?.gte || d >= r.gte) && (!r?.lte || d <= r.lte)

vi.mock("@/lib/prisma", () => ({
  prisma: {
    caffeineLog: {
      findMany: async ({ where }: { where: { loggedAt?: Range } }) =>
        db.caffeine.filter(c => inRange(c.loggedAt, where.loggedAt)),
    },
    intakeLog: {
      findMany: async ({ where }: { where: { loggedAt?: Range; type?: { in: string[] } } }) =>
        db.intake.filter(i => inRange(i.loggedAt, where.loggedAt) && (!where.type || where.type.in.includes(i.type))),
    },
    $queryRaw: async () => db.tags,
  },
}))
vi.mock("@/lib/user-timezone", () => ({ getUserTimezone: async () => "Europe/Bratislava" }))
vi.mock("@/lib/caffeine-profile", () => ({
  getPersonalCaffeineProfile: async () => ({ halfLifeH: db.halfLifeH, usedDefault: db.usedDefault }),
}))
vi.mock("@/lib/goals", () => ({ getGoals: async () => ({ weightKg: 80, sex: "male", coffeeMax: 400 }) }))
vi.mock("@/lib/weight-series", () => ({ latestWeightKg: async () => null, loadWeightSeries: async () => [] }))

import { runQuickAnswer } from "@/lib/quick-answer-run"
import { bodyLoadFrom } from "@/lib/body-load-now"

const tag = (name: string, at: string) =>
  ({ id: `manual_${name}`, tagName: name, text: null, timestamp: new Date(at), doseAmount: null, doseUnit: null })

beforeEach(() => {
  db.caffeine = []
  db.intake = []
  db.tags = []
  db.halfLifeH = 5
  db.usedDefault = true
  vi.useFakeTimers({ toFake: ["Date"] })
})
afterEach(() => { vi.useRealTimers() })

describe("what is still in my body — the scripted answer", () => {
  it("names a medicine still on board instead of saying nothing much", async () => {
    // 22:00 Bratislava (CEST) the night before; asked at 08:00.
    db.tags = [tag("Atarax", "2026-09-26T20:00:00Z")]
    vi.setSystemTime(new Date("2026-09-27T06:00:00Z"))
    const a = await runQuickAnswer("u1", "is atarax still in my system?")
    expect(a).not.toBeNull()
    expect(a!.reply).not.toMatch(/Nothing much/)
    expect(a!.reply).toMatch(/Atarax/)
    expect(a!.reply).toMatch(/71%/)
    expect(a!.reply).toMatch(/22:00/)
    expect(a!.sources.map(s => s.key)).toContain("meds")
  })

  it("names a medicine it has no half-life for rather than calling the body clear", async () => {
    db.tags = [tag("Stilnox", "2026-09-27T05:00:00Z")]
    vi.setSystemTime(new Date("2026-09-27T06:00:00Z"))
    const a = await runQuickAnswer("u1", "what's in my system right now?")
    expect(a!.reply).not.toMatch(/Nothing much/)
    expect(a!.reply).toMatch(/Stilnox/)
    expect(a!.reply).toMatch(/07:00/)
    expect(a!.reply).toMatch(/no half-life on file/)
  })

  it("hands a named medicine it cannot see on board to Emergy", async () => {
    // Nothing logged: "nothing much" would read as "the atarax is gone",
    // which is a claim about a dose the app never saw.
    vi.setSystemTime(new Date("2026-09-27T06:00:00Z"))
    expect(await runQuickAnswer("u1", "is atarax still in my system?")).toBeNull()
  })

  it("still answers a caffeine question even though 'caffeine' is in the med table", async () => {
    db.caffeine = [{ caffeineMg: 200, loggedAt: new Date("2026-09-27T12:00:00Z"), compound: "coffee" }]
    vi.setSystemTime(new Date("2026-09-27T20:00:00Z"))
    const a = await runQuickAnswer("u1", "how much caffeine is still in my body")
    expect(a).not.toBeNull()
  })

  it("says the body is clear only when nothing at all was logged", async () => {
    vi.setSystemTime(new Date("2026-09-27T06:00:00Z"))
    const a = await runQuickAnswer("u1", "what's in my system right now?")
    expect(a!.reply).toMatch(/Nothing much/)
  })
})

describe("scripted caffeine answers use the user's own half-life", () => {
  beforeEach(() => {
    db.halfLifeH = 7
    db.usedDefault = false
    // 200mg at 14:00 local, asked at 22:00 local: 91mg at 7h, 66mg at 5h.
    db.caffeine = [{ caffeineMg: 200, loggedAt: new Date("2026-09-27T12:00:00Z"), compound: "coffee" }]
    vi.setSystemTime(new Date("2026-09-27T20:00:00Z"))
  })

  it("body_now", async () => {
    const a = await runQuickAnswer("u1", "how much caffeine is still in my body")
    expect(a!.reply).toMatch(/\*\*91mg\*\*/)
  })

  it("caffeine_today", async () => {
    const a = await runQuickAnswer("u1", "how much caffeine have I had today")
    expect(a!.reply).toMatch(/\*\*91mg\*\* still circulating/)
  })
})

describe("bodyLoadFrom — the one computation behind the tab and the script", () => {
  const now = new Date("2026-09-27T06:00:00Z")
  const base = { caffeineDoses: [], drinks: [], medTags: [], halfLifeH: 5, personalHalfLife: false, weightKg: 80, sex: "male" }

  it("keeps unknown medicines as unmodeled, once each, newest dose", () => {
    const r = bodyLoadFrom({
      ...base,
      medTags: [tag("Stilnox", "2026-09-26T20:00:00Z"), tag("Stilnox", "2026-09-27T05:00:00Z")],
    }, now)
    expect(r.substances).toEqual([])
    expect(r.unmodeled).toEqual([{ name: "Stilnox", takenAt: "2026-09-27T05:00:00.000Z", sourceId: "manual_Stilnox" }])
  })

  it("does not list a stored supplement as unknown — the app knows it has no hour-scale curve", () => {
    const r = bodyLoadFrom({ ...base, medTags: [tag("Vitamin D 2000IU", "2026-09-27T05:00:00Z")] }, now)
    expect(r.unmodeled).toEqual([])
  })

  it("never lists a drink tag as a medicine", () => {
    const r = bodyLoadFrom({ ...base, medTags: [tag("Beer", "2026-09-27T05:00:00Z")] }, now)
    expect(r.unmodeled).toEqual([])
  })
})

describe("the In my body tab", () => {
  const strip = (f: string) =>
    readFileSync(f, "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  it("says 'Clear right now' only when there is no unmodeled medicine either", () => {
    const tab = strip("src/components/intake/BodyLoadTab.tsx")
    expect(tab).toMatch(/unmodeled/)
    expect(tab).toMatch(/no half-life on file/)
  })
  it("the route serves the shared computation rather than its own copy", () => {
    const route = strip("src/app/api/body-load/route.ts")
    expect(route).toMatch(/computeBodyLoad\(/)
    expect(route).not.toMatch(/decayFraction\(/)
  })
})
