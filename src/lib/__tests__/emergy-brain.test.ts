import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"

// Emergy's tools and system prompt, run against an in-memory database. Each
// block below is a thing he told the user that the database did not back up.

// A Prisma call's argument, loosely: each handler reads the one or two fields
// it cares about, and typing the whole client would dwarf the tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Args = any

const st = vi.hoisted(() => {
  const state = {
    calls: [] as { model: string; method: string; args: Args }[],
    handlers: {} as Record<string, (args: Args) => unknown>,
    raw: (_sql: string): unknown => [],
  }
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, method: string) => (args: Args) => {
        state.calls.push({ model: name, method, args })
        return Promise.resolve().then(() => {
          const h = state.handlers[`${name}.${method}`]
          if (h) return h(args)
          if (method === "findMany" || method === "groupBy") return []
          if (method === "count") return 0
          if (["create", "upsert", "update"].includes(method)) return { id: "row1", ...(args?.data ?? args?.create ?? {}) }
          if (method === "deleteMany" || method === "updateMany") return { count: 0 }
          return null
        })
      },
    })
  const prisma: Args = new Proxy({}, {
    get: (_t, name: string) => {
      if (name === "then") return undefined
      if (name === "$queryRaw") {
        return (strings: TemplateStringsArray) => Promise.resolve().then(() => state.raw(strings.join("?")))
      }
      if (name === "$executeRaw") return () => Promise.resolve(1)
      if (name === "$transaction") return (ops: Args) => (Array.isArray(ops) ? Promise.all(ops) : ops(prisma))
      return model(name)
    },
  })
  return { state, prisma }
})

const phone = vi.hoisted(() => ({ nights: [] as { day: string; minutes: number }[] }))

vi.mock("@/lib/prisma", () => ({ prisma: st.prisma }))
vi.mock("@/lib/phone-sleep", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/phone-sleep")>()),
  phoneNights: async () => phone.nights,
}))
vi.mock("@/lib/google-calendar", () => ({ getEventsInRange: async () => [], getTodayEvents: async () => [] }))

import { executeTool, buildSystemPrompt } from "@/lib/claude"

const TZ = "Europe/Bratislava"
const db = st.state

beforeEach(() => {
  db.calls = []
  db.handlers = {
    "userPreference.findUnique": (a: Args) => (a?.where?.userId_key?.key === "timezone" ? { value: TZ } : null),
  }
  db.raw = () => []
  phone.nights = []
  // Tuesday 29 Sept 2026, 09:00 in Bratislava.
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-09-29T07:00:00Z"))
})
afterEach(() => { vi.useRealTimers() })

const called = (model: string, method: string) => db.calls.filter(c => c.model === model && c.method === method)
const neonBlip = () => { throw new Error("Connection terminated unexpectedly") }

describe("a drink Emergy says he logged is a drink that was written", () => {
  // A Neon blip during "log 500ml water": recordDrink logged the failure and
  // returned null, and the tool said "Logged 500ml of water" anyway. The ring
  // never moved and nothing said why — the 26 Sept "Logged 🍲" bug on drinks.
  it("log_water owns up when the write failed", async () => {
    db.handlers["intakeLog.create"] = neonBlip
    const r = await executeTool("log_water", { amountMl: "500" }, "u1")
    expect(r).not.toMatch(/^Logged/)
    expect(r).toMatch(/Worth retrying/)
  })

  it("log_coffee owns up when the write failed", async () => {
    db.handlers["intakeLog.create"] = neonBlip
    const r = await executeTool("log_coffee", { amountMl: "200" }, "u1")
    expect(r).not.toMatch(/^Logged/)
    expect(r).toMatch(/Worth retrying/)
  })

  it("a non-numeric amount is never written or said back as NaN", async () => {
    const r = await executeTool("log_water", { amountMl: "a glass" }, "u1")
    expect(r).not.toMatch(/NaN/)
    for (const c of called("intakeLog", "create")) expect(Number.isFinite(c.args.data.amountMl)).toBe(true)
  })

  it("log_coffee says so when the caffeine half did not save", async () => {
    db.handlers["caffeineLog.upsert"] = neonBlip
    const r = await executeTool("log_coffee", { amountMl: "200" }, "u1")
    expect(r).toMatch(/caffeine/i)
    expect(r).toMatch(/didn't save/)
  })
})

describe("log_drink without a caffeine figure still counts the caffeine", () => {
  // "had a flat white 160ml": the model left caffeineMg out, the handler
  // passed null, and recordDrink reads null as "none" — so the coffee was
  // logged with no caffeine at all, missing from body load and the cutoff.
  it("falls back to the app's estimate", async () => {
    const r = await executeTool("log_drink", { name: "Flat white", drinkType: "coffee", amountMl: "160" }, "u1")
    const mirror = called("caffeineLog", "upsert")
    expect(mirror).toHaveLength(1)
    expect(mirror[0].args.create.caffeineMg).toBeGreaterThan(0)
    expect(r).toMatch(new RegExp(`≈${mirror[0].args.create.caffeineMg}mg caffeine`))
  })

  it("an explicit 0 still means none", async () => {
    await executeTool("log_drink", { name: "Decaf", drinkType: "coffee", amountMl: "160", caffeineMg: 0 } as unknown as Record<string, string>, "u1")
    expect(called("caffeineLog", "upsert")).toHaveLength(0)
  })
})

describe("drink tools quote the day's totals from the database", () => {
  // Emergy kept a running tally of his own across a long evening and it
  // drifted from the rows (26 Sept). The tool now answers with the log's own
  // totals, so the number he repeats is the one the Intake tab shows.
  it("log_water answers with today's fluid and alcohol as stored", async () => {
    db.handlers["intakeLog.findMany"] = () => [
      { type: "water", amountMl: 500, note: null },
      { type: "wine", amountMl: 150, note: null },
    ]
    const r = await executeTool("log_water", { amountMl: "500" }, "u1")
    expect(r).toMatch(/^Logged 500ml of water/)
    expect(r).toMatch(/560ml fluid/)
    expect(r).toMatch(/14g alcohol/)
  })
})

describe("log_mood on a check-in day", () => {
  // The morning check-in said 4. At 18:00 "log mood 1" was answered "Logged
  // mood: 1/5 for today" — and every reader kept saying 4, because the
  // check-in wins (lib/mood-series). The reply has to say which one stands.
  it("says the check-in's mood still stands", async () => {
    db.raw = sql => (sql.includes("MorningCheckIn") ? [{ date: "2026-09-29", mood: 4 }] : [])
    db.handlers["moodLog.findMany"] = () => [{ date: new Date("2026-09-29T00:00:00Z"), mood: 1 }]
    const r = await executeTool("log_mood", { mood: "1" }, "u1")
    expect(r).not.toMatch(/^Logged mood: 1\/5/)
    expect(r).toMatch(/4\/5/)
    expect(r).toMatch(/check-in/)
  })

  it("says Logged when nothing overrides it", async () => {
    const r = await executeTool("log_mood", { mood: "3" }, "u1")
    expect(r).toMatch(/^Logged mood: 3\/5/)
  })
})

describe("get_health_range carries every drink, not just water and coffee", () => {
  // Nine evenings of wine logged in the app came back as nine evenings with
  // no drinking, and "is drinking messing with my sleep?" was reasoned over a
  // missing reading as if it were zero.
  it("lists wine with its ethanol and totals fluid from every drink", async () => {
    db.handlers["intakeLog.findMany"] = () => [
      { loggedAt: new Date("2026-09-28T18:00:00Z"), type: "wine", amountMl: 300, note: null },
      { loggedAt: new Date("2026-09-28T09:00:00Z"), type: "sparkling", amountMl: 1000, note: null },
      { loggedAt: new Date("2026-09-28T10:00:00Z"), type: "tea", amountMl: 500, note: null },
    ]
    const r = await executeTool("get_health_range", { days: "7" }, "u1")
    const row = r.split("\n").find(l => l.startsWith("2026-09-28"))!
    expect(row).toMatch(/wine 300ml/)
    expect(row).toMatch(/≈28g ethanol/)
    expect(row).toMatch(/sparkling 1000ml/)
    expect(row).toMatch(/tea 500ml/)
    expect(row).toMatch(/fluid 1620ml/)
  })
})

describe("the system prompt", () => {
  const day = (iso: string) => new Date(iso + "T00:00:00Z")
  const daysBack = (from: string, n: number) =>
    Array.from({ length: n }, (_, i) => new Date(Date.parse(from + "T00:00:00Z") - i * 86_400_000))

  it("gives the streak the Habits page gives — schedule, skips and yesterday's run", async () => {
    db.handlers["habit.findMany"] = () => [
      // 42 days done through yesterday; not yet today at 09:00.
      { name: "Meditation", scheduleDays: [], timesPerWeek: null,
        completions: daysBack("2026-09-28", 42).map(date => ({ date })), skips: [] },
      // Mon/Wed/Fri — and today is a Tuesday.
      { name: "Gym", scheduleDays: [1, 3, 5], timesPerWeek: null,
        completions: [day("2026-09-28"), day("2026-09-25"), day("2026-09-23")].map(date => ({ date })), skips: [] },
      // Skipped today with skip_habit_today, whose reply promised "the streak holds".
      { name: "Run", scheduleDays: [], timesPerWeek: null,
        completions: daysBack("2026-09-28", 5).map(date => ({ date })), skips: [{ date: day("2026-09-29") }] },
    ]
    const { prompt } = await buildSystemPrompt("u1")
    expect(prompt).toMatch(/- Meditation: 42-day streak, not done yet today/)
    expect(prompt).toMatch(/- Gym: 3-day streak, not due today/)
    expect(prompt).toMatch(/- Run: 5-day streak, skipped today \(streak holds\)/)
  })

  it("counts sparkling water and tea as fluid", async () => {
    // The Overview tile said 1.5L; Emergy was told "Water: 0ml" and nudged
    // him to drink water — what lib/hydration exists to prevent.
    db.handlers["intakeLog.findMany"] = () => [
      { type: "sparkling", amountMl: 1000, note: null, loggedAt: new Date("2026-09-29T06:00:00Z") },
      { type: "tea", amountMl: 500, note: null, loggedAt: new Date("2026-09-29T06:30:00Z") },
    ]
    const { prompt } = await buildSystemPrompt("u1")
    expect(prompt).not.toMatch(/Water: 0ml/)
    expect(prompt).toMatch(/Fluid: 1500ml/)
  })

  it("keys the ring gap on the newest night, not the newest row", async () => {
    // Health Connect wrote today's row with steps and no sleep, so the newest
    // row was "today" and the missing night — and the phone's estimate of it —
    // never reached the prompt.
    db.handlers["healthLog.findMany"] = (a: Args) => a?.take === 14
      ? [
          { date: day("2026-09-29"), steps: 1200, sleepDuration: null },
          { date: day("2026-09-28"), steps: 9000, sleepDuration: 430 },
        ]
      : []
    phone.nights = [{ day: "2026-09-29", minutes: 420 }]
    const { prompt } = await buildSystemPrompt("u1")
    expect(prompt).toMatch(/## Wearable coverage/)
    expect(prompt).toMatch(/last recorded night is 2026-09-28/)
    expect(prompt).toMatch(/phone's own Sleep API/)
  })
})

describe("the briefing's fallback names the newest recorded NIGHT", () => {
  // Same shape as the prompt's ring gap: a steps-only row for today made the
  // brief say "The newest recorded night is <today>" of a day with no night.
  it("reads its latest row from nights only", () => {
    const src = readFileSync("src/app/api/briefing/route.ts", "utf8")
    const q = src.slice(src.indexOf("const [checkinRows, latestHealth"))
    const latest = q.slice(q.indexOf("prisma.healthLog.findFirst("), q.indexOf("}).catch(() => null)"))
    expect(latest).toMatch(/sleepDuration:\s*\{\s*not:\s*null\s*\}/)
  })
})
