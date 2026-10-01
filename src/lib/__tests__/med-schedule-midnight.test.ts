import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"

// Doses were counted by the calendar day they were logged on. Atarax is due
// at 22:00 and taken at 00:30: the night it belonged to scored a miss, and
// from 00:30 the new day showed tonight's 22:00 as already taken — the page,
// the phone's alarm and the server push all skipped it, an evening without
// the reminder for a sedative that the user believes they still owe.
//
// And one pill tagged in the Oura app and ticked off in the app is two rows.
// With doses at 08:00 and 20:00 the morning pill covered both slots and the
// evening one was never asked for.

const db = {
  schedules: [] as { id: string; userId: string; name: string; dose: string | null; times: string[]; daysOfWeek: number[]; active: boolean; remind: boolean; note: string | null; startDate: string | null; endDate: string | null; createdAt: Date }[],
  doses: [] as { id: string; day: string; timestamp: Date; tagName: string | null; text: string | null }[],
  sent: [] as { body: string }[],
}

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/user-timezone", () => ({ getUserTimezone: async () => "Europe/Bratislava" }))
vi.mock("@/lib/cron-auth", () => ({ requireCronSecret: () => null }))
vi.mock("@/lib/push", () => ({
  configurePush: () => true,
  loadSubscriptionsByUser: async () => new Map([["u1", {}]]),
  loadLocalCoverage: async () => new Map(),
  phoneCovers: () => false,
  sendToUser: async (_: unknown, payload: { body: string }) => { db.sent.push(payload); return true },
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    medSchedule: { findMany: async () => db.schedules },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?")
      if (sql.includes("med_reminder_state")) return []
      // The dose queries filter by day: `"day" >= x` or `"day" = x`.
      const bound = values.find(v => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) as string | undefined
      const exact = /"day"\s*=\s*\?/.test(sql)
      return db.doses.filter(d => !bound || (exact ? d.day === bound : d.day >= bound))
    },
    $executeRaw: async () => 1,
  },
}))

import { GET } from "@/app/api/med-schedule/route"
import { GET as CRON } from "@/app/api/cron/med-reminders/route"
import { adherenceOver, toDose } from "@/lib/med-schedule"

const TZ = "Europe/Bratislava"
const sched = (name: string, times: string[]) => ({
  id: `s_${name}`, userId: "u1", name, dose: null, times, daysOfWeek: [], active: true, remind: true,
  note: null, startDate: null, endDate: null, createdAt: new Date(0),
})
// `at` is UTC; Bratislava is UTC+2 through October 25.
const dose = (id: string, name: string, at: string) => {
  const timestamp = new Date(at)
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(timestamp)
  return { id, day, timestamp, tagName: name, text: null }
}

async function page() {
  const data = await (await GET()).json()
  return data.items[0] as { takenToday: number; today: { time: string; status: string }[]; adherence: { missedDays: string[] } }
}

beforeEach(() => {
  db.schedules = []
  db.doses = []
  db.sent = []
  vi.useFakeTimers({ toFake: ["Date"] })
})
afterEach(() => { vi.useRealTimers() })

describe("a dose after local midnight", () => {
  it("fills last night's slot, not tonight's", async () => {
    db.schedules = [sched("Atarax", ["22:00"])]
    // Taken 00:30 on 1 Oct, for the 22:00 of 30 Sept. Asked at 00:40.
    db.doses = [dose("manual_a", "Atarax", "2026-09-30T22:30:00Z")]
    vi.setSystemTime(new Date("2026-09-30T22:40:00Z"))
    const item = await page()
    expect(item.takenToday, "tonight's alarm would be skipped").toBe(0)
    expect(item.today.map(t => t.status)).toEqual(["upcoming"])
    expect(item.adherence.missedDays).not.toContain("2026-09-30")
  })

  it("still gets tonight's reminder from the server", async () => {
    db.schedules = [sched("Atarax", ["22:00"])]
    db.doses = [dose("manual_a", "Atarax", "2026-09-30T22:30:00Z")]
    // 22:10 on 1 Oct.
    vi.setSystemTime(new Date("2026-10-01T20:10:00Z"))
    await CRON(new Request("http://x/api/cron/med-reminders") as never)
    expect(db.sent.map(s => s.body)).toEqual(["Atarax"])
  })

  it("covers today's morning slot when last night is already done", async () => {
    db.schedules = [sched("Stilnox", ["08:00", "22:00"])]
    db.doses = [
      dose("manual_m", "Stilnox", "2026-09-30T06:00:00Z"),
      dose("manual_e", "Stilnox", "2026-09-30T20:00:00Z"),
      dose("manual_x", "Stilnox", "2026-09-30T22:30:00Z"),
    ]
    vi.setSystemTime(new Date("2026-09-30T23:00:00Z"))
    const item = await page()
    expect(item.takenToday).toBe(1)
  })

  it("leaves a once-daily morning medicine on its own day", () => {
    const elicea = { id: "e", name: "Elicea", times: ["08:00"], daysOfWeek: [], active: true }
    const doses = [
      // Varying times, 08:00–16:00, and one very early on the 30th.
      dose("manual_1", "Elicea", "2026-09-27T13:30:00Z"),
      dose("manual_2", "Elicea", "2026-09-28T06:00:00Z"),
      dose("manual_3", "Elicea", "2026-09-29T23:00:00Z"),
    ].map(r => toDose(r, TZ)!)
    const [a] = adherenceOver([elicea], doses, ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"])
    // 01:00 is seven hours before today's 08:00 and seventeen after
    // yesterday's: it is today's early dose, and yesterday stays missed.
    expect(a.missedDays).toEqual(["2026-09-29"])
  })
})

describe("one dose logged in both Oura and the app", () => {
  it("fills one slot, not two", async () => {
    db.schedules = [sched("Elicea", ["08:00", "20:00"])]
    db.doses = [
      dose("oura_tag_1", "Elicea", "2026-09-30T06:05:00Z"),
      dose("manual_b", "Elicea 10 mg", "2026-09-30T06:25:00Z"),
    ]
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"))
    const item = await page()
    expect(item.takenToday).toBe(1)
    expect(item.today.map(t => t.status)).toEqual(["taken", "upcoming"])
  })

  it("still counts two taps in the app as two doses", async () => {
    db.schedules = [sched("Elicea", ["08:00", "20:00"])]
    db.doses = [
      dose("manual_a", "Elicea", "2026-09-30T06:05:00Z"),
      dose("manual_b", "Elicea", "2026-09-30T06:25:00Z"),
    ]
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"))
    expect((await page()).takenToday).toBe(2)
  })

  it("does not suppress the evening push", async () => {
    db.schedules = [sched("Elicea", ["08:00", "20:00"])]
    db.doses = [
      dose("oura_tag_1", "Elicea", "2026-09-30T06:05:00Z"),
      dose("manual_b", "Elicea", "2026-09-30T06:25:00Z"),
    ]
    vi.setSystemTime(new Date("2026-09-30T18:10:00Z"))
    await CRON(new Request("http://x/api/cron/med-reminders") as never)
    expect(db.sent.map(s => s.body)).toEqual(["Elicea"])
  })
})

describe("Emergy's adherence read", () => {
  // It kept its own count: every tag matching the name, all 14 days, today
  // included — so a dose in both Oura and the app counted twice, a 00:30 dose
  // counted for the wrong night, and an as-needed schedule expected one a day.
  const src = readFileSync("src/lib/claude.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")
  const block = src.slice(src.indexOf('kind === "adherence"'), src.indexOf('kind === "patterns"'))

  it("counts through the shared rule the page and the cron use", () => {
    expect(block).toMatch(/adherenceOver\(/)
    expect(block).toMatch(/toDose\(/)
    expect(block).not.toMatch(/Math\.max\(1, s\.times\.length\)/)
  })

  it("names as-needed schedules by what was taken, not against a quota", () => {
    expect(block).toMatch(/as needed/)
  })
})
