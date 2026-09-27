import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// The MCP server is the Health connector in the owner's Claude.ai. Whatever it
// returns, Claude repeats back to him as fact — so every tool here is driven
// end to end, through the real route and a real JSON-RPC tools/call, with only
// the database and Oura's HTTP API stubbed out.
//
// The account is in Europe/Prague (UTC+2 in September) and the clock is fixed
// at 12:00 local on Sunday 27 Sept 2026, so anything that works out a day or a
// clock time in UTC shows up as two hours adrift.

type Fn = ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>

const db = vi.hoisted(() => {
  const model = () => ({
    findMany: vi.fn(async (..._a: unknown[]): Promise<unknown> => []),
    findFirst: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
    findUnique: vi.fn(async (..._a: unknown[]): Promise<unknown> => null),
    create: vi.fn(async (...a: unknown[]): Promise<unknown> => ({ id: "new", ...(a[0] as { data: object }).data })),
    update: vi.fn(async (...a: unknown[]): Promise<unknown> => (a[0] as { data: object }).data),
    updateMany: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ count: 1 })),
    upsert: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({})),
    delete: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({})),
  })
  return {
    mcpApiKey: { ...model(), findUnique: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ userId: "u1" })) },
    userPreference: { ...model(), findUnique: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ value: "Europe/Prague" })) },
    user: { ...model(), findFirst: vi.fn(async (..._a: unknown[]): Promise<unknown> => ({ id: "u1" })) },
    reminder: model(), intakeLog: model(), foodLog: model(), focusSession: model(),
    chatMessage: model(), habit: model(), habitCompletion: model(), healthLog: model(),
    bodyMeasurement: model(), moodLog: model(), morningCheckIn: model(), ouraTag: model(),
    dailyNote: model(), ouraToken: model(),
    $queryRaw: vi.fn(async (..._a: unknown[]): Promise<unknown> => []),
  }
})
vi.mock("@/lib/prisma", () => ({ prisma: db }))
const phoneDay = vi.hoisted(() => ({ phoneDaySummary: vi.fn(async (..._a: unknown[]): Promise<unknown> => null) }))
vi.mock("@/lib/phone-day", () => phoneDay)

import { NextRequest } from "next/server"
import { POST } from "@/app/api/mcp/route"
import { POST as SERVICE_POST } from "@/app/api/service/route"
import { sumHydration } from "@/lib/hydration"

const NOW = new Date("2026-09-27T10:00:00Z") // 12:00 in Prague
// Prague's local day 2026-09-27 runs between these two instants.
const DAY_START = "2026-09-26T22:00:00.000Z"
const DAY_END = "2026-09-27T21:59:59.999Z"

async function call(name: string, args: Record<string, unknown> = {}) {
  const req = new NextRequest("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer key",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  })
  const raw = await (await POST(req)).text()
  const line = raw.split("\n").find(l => l.startsWith("data: "))
  const msg = JSON.parse(line ? line.slice(6) : raw) as {
    result?: { content: { text: string }[]; isError?: boolean }
    error?: { message: string }
  }
  const text = msg.result?.content?.[0]?.text ?? msg.error?.message ?? ""
  let json: unknown = null
  try { json = JSON.parse(text) } catch { /* a plain sentence */ }
  return { text, json, isError: !!msg.error || !!msg.result?.isError }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const arg = (fn: Fn, i = 0): any => fn.mock.calls[i]?.[0]
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d)

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  for (const m of Object.values(db)) {
    if (typeof m === "function") (m as Fn).mockReset()
    else for (const f of Object.values(m)) (f as Fn).mockReset()
  }
  fetchMock = vi.fn()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ─── Reminders ────────────────────────────────────────────────────────────────

describe("complete_reminder moves a repeating reminder on instead of ending it", () => {
  // "I took my vitamin D" set isCompleted on the series row itself. The phone's
  // scheduler skips completed rows, so a daily reminder never rang again —
  // while the reply said "Marked as done" and nothing hinted the series was over.
  const series = {
    id: "vit", userId: "u1", title: "Vitamin D", description: null,
    dueDate: new Date("2026-09-27T00:00:00Z"), reminderTime: "09:00", priority: "normal",
    tags: [], repeat: "daily", repeatUntil: null, isCompleted: false, completedAt: null, seriesId: null,
  }

  it("files a done copy and rolls the series to tomorrow", async () => {
    db.reminder.findFirst.mockResolvedValue(series)
    db.reminder.findMany.mockResolvedValue([series])
    const r = await call("complete_reminder", { title: "vitamin" })

    const endedTheSeries = db.reminder.update.mock.calls.some(c =>
      (c[0] as { where: { id: string }; data: { isCompleted?: boolean } }).where.id === "vit" &&
      (c[0] as { data: { isCompleted?: boolean } }).data.isCompleted === true)
    expect(endedTheSeries, "the series row was marked done — it will never ring again").toBe(false)
    expect(db.reminder.create).toHaveBeenCalledTimes(1)
    expect(arg(db.reminder.create).data).toMatchObject({ isCompleted: true, seriesId: "vit" })
    expect(r.text).toMatch(/2026-09-28/)
  })

  it("the service API goes through the same rule", async () => {
    process.env.CRON_SECRET = "s"
    db.reminder.findFirst.mockResolvedValue(series)
    const res = await SERVICE_POST(new NextRequest("http://localhost/api/service", {
      method: "POST",
      headers: { authorization: "Bearer s", "content-type": "application/json" },
      body: JSON.stringify({ action: "complete_reminder", email: "a@b.c", id: "vit" }),
    }))
    expect(res.status).toBe(200)
    expect(db.reminder.updateMany).not.toHaveBeenCalled()
    expect(arg(db.reminder.create).data).toMatchObject({ isCompleted: true, seriesId: "vit" })
    expect(await res.json()).toMatchObject({ ok: true, rolledTo: "2026-09-28" })
  })

  it("an unknown id is a 404 from the service API, not ok", async () => {
    process.env.CRON_SECRET = "s"
    const res = await SERVICE_POST(new NextRequest("http://localhost/api/service", {
      method: "POST",
      headers: { authorization: "Bearer s", "content-type": "application/json" },
      body: JSON.stringify({ action: "complete_reminder", email: "a@b.c", id: "nope" }),
    }))
    expect(res.status).toBe(404)
  })
})

describe("get_reminders with include_completed still shows what is open", () => {
  // One query over every row, oldest due date first, capped at 30: two months
  // of ticked "Vitamin D" copies filled the page and pushed out every open
  // reminder this week.
  it("returns open reminders even when old done copies outnumber the cap", async () => {
    const open = { id: "o", title: "Dentist", dueDate: new Date("2026-09-29T00:00:00Z"), reminderTime: "10:00", repeat: null, priority: "high", isCompleted: false, completedAt: null }
    const oldDone = Array.from({ length: 30 }, (_, i) => ({
      id: `d${i}`, title: "Vitamin D", dueDate: new Date(Date.UTC(2026, 6, 1 + i)), reminderTime: "09:00",
      repeat: null, priority: "normal", isCompleted: true, completedAt: new Date(Date.UTC(2026, 6, 1 + i, 9)),
    }))
    db.reminder.findMany.mockImplementation(async (...a: unknown[]) => {
      const where = (a[0] as { where: { isCompleted?: boolean } }).where
      if (where.isCompleted === false) return [open]
      if (where.isCompleted === true) return oldDone.slice(0, 20)
      return oldDone // what an unfiltered, due-date-ascending query of 30 gives back
    })
    const r = await call("get_reminders", { include_completed: true })
    const rows = r.json as { id: string; reminder_time: string | null; repeat: string | null }[]
    expect(rows.map(x => x.id)).toContain("o")
    expect(rows[0]).toMatchObject({ id: "o", reminder_time: "10:00", repeat: null })
  })
})

describe("create_reminder only reports an alarm that will ring", () => {
  it("a time with no date rings at the next occurrence", async () => {
    // It stored reminderTime with no dueDate; the phone never rings a row
    // without a date, and the reply said "Reminder created".
    const r = await call("create_reminder", { title: "take my pills", reminder_time: "18:00" })
    const data = arg(db.reminder.create).data
    expect(iso(data.dueDate)).toBe("2026-09-27T00:00:00.000Z")
    expect(data.reminderTime).toBe("18:00")
    expect(r.text).toMatch(/today at 18:00/)
  })

  it("an unreadable time is refused rather than silently rung at 09:00", async () => {
    const r = await call("create_reminder", { title: "pills", reminder_time: "6pm" })
    expect(db.reminder.create).not.toHaveBeenCalled()
    expect(r.text).toMatch(/HH:MM/)
  })

  it("a due date that is not YYYY-MM-DD is refused, not thrown at Prisma", async () => {
    const r = await call("create_reminder", { title: "pills", due_date: "tomorrow" })
    expect(r.isError).toBe(true)
    expect(db.reminder.create).not.toHaveBeenCalled()
  })
})

describe("dates and amounts from the model are validated", () => {
  it("an unpadded date is refused instead of answering 'no check-ins'", async () => {
    // "2026-9-1" compares as a string against "2026-09-…" and matched nothing.
    const r = await call("get_checkins", { startDate: "2026-9-1", endDate: "2026-9-30" })
    expect(r.isError).toBe(true)
    expect(db.morningCheckIn.findMany).not.toHaveBeenCalled()
  })

  it("get_journal takes 'today' or a padded date, and refuses the rest", async () => {
    expect((await call("get_journal", { date: "2026-9-1" })).isError).toBe(true)
    expect(db.dailyNote.findUnique).not.toHaveBeenCalled()
    await call("get_journal", { date: "today" })
    expect(iso(arg(db.dailyNote.findUnique).where.userId_date.date)).toBe("2026-09-27T00:00:00.000Z")
  })

  it("a zero or negative drink is refused", async () => {
    expect((await call("log_intake", { type: "water", amount_ml: 0 })).isError).toBe(true)
    expect((await call("log_intake", { type: "water", amount_ml: -250 })).isError).toBe(true)
  })

  it("a zero-minute or day-long focus session is refused", async () => {
    expect((await call("log_focus_session", { duration_min: 0 })).isError).toBe(true)
    expect((await call("log_focus_session", { duration_min: 5000 })).isError).toBe(true)
    expect(db.focusSession.create).not.toHaveBeenCalled()
  })
})

// ─── Local days and local clock times ─────────────────────────────────────────

describe("timestamp columns are windowed by the user's day, and times are local", () => {
  const drinks = [
    { id: "a", type: "water", amountMl: 1000, note: null, loggedAt: new Date("2026-09-26T23:10:00Z") }, // 01:10 local
    { id: "b", type: "sparkling", amountMl: 500, note: null, loggedAt: new Date("2026-09-27T06:15:00Z") },
    { id: "c", type: "tea", amountMl: 500, note: null, loggedAt: new Date("2026-09-27T14:30:00Z") },
  ]

  it("get_intake_today: local-day window, local times, glasses from every hydrating drink", async () => {
    db.intakeLog.findMany.mockResolvedValue(drinks)
    const r = await call("get_intake_today")
    const where = arg(db.intakeLog.findMany).where
    expect(iso(where.loggedAt.gte)).toBe(DAY_START)
    expect(iso(where.loggedAt.lte)).toBe(DAY_END)
    const out = r.json as { entries: { time: string }[]; water_glasses: number; hydration_ml: number }
    expect(out.entries.map(e => e.time)).toEqual(["01:10", "08:15", "16:30"])
    // It counted rows typed "water" only: 4 glasses here, while the briefing
    // and the app's tile said 8 for the same drinks.
    expect(out.hydration_ml).toBe(sumHydration(drinks))
    expect(out.water_glasses).toBe(Math.round(sumHydration(drinks) / 250 * 10) / 10)

    db.intakeLog.findMany.mockResolvedValue(drinks)
    const brief = (await call("get_daily_briefing")).json as { intake: { water_ml: number; water_glasses: number } }
    expect(brief.intake.water_glasses).toBe(out.water_glasses)
  })

  it("get_food_log: local-day window and local meal times", async () => {
    db.foodLog.findMany.mockResolvedValue([{
      name: "Dinner", mealType: "dinner", calories: 700, proteinG: 30, carbsG: 80, fatG: 20, sugarG: 5,
      items: [], micros: null, note: null, place: null, loggedAt: new Date("2026-09-25T17:30:00Z"),
    }])
    const r = await call("get_food_log", { date: "2026-09-25" })
    expect(iso(arg(db.foodLog.findMany).where.loggedAt.gte)).toBe("2026-09-24T22:00:00.000Z")
    expect(iso(arg(db.intakeLog.findMany).where.loggedAt.lte)).toBe("2026-09-25T21:59:59.999Z")
    expect((r.json as { meals: { time: string }[] }).meals[0].time).toBe("19:30")
  })

  it("get_focus_sessions and get_chat_history: local-day bounds", async () => {
    await call("get_focus_sessions", { startDate: "2026-09-26", endDate: "2026-09-26" })
    expect(iso(arg(db.focusSession.findMany).where.endedAt.gte)).toBe("2026-09-25T22:00:00.000Z")
    expect(iso(arg(db.focusSession.findMany).where.endedAt.lte)).toBe("2026-09-26T21:59:59.999Z")

    await call("get_chat_history", { startDate: "2026-09-26", endDate: "2026-09-27" })
    expect(iso(arg(db.chatMessage.findMany).where.createdAt.gte)).toBe("2026-09-25T22:00:00.000Z")
    expect(iso(arg(db.chatMessage.findMany).where.createdAt.lte)).toBe(DAY_END)
  })

  it("get_oura_tags: a 06:00 pill is reported at 06:00, not 04:00", async () => {
    db.ouraTag.findMany.mockResolvedValue([
      { day: "2026-09-27", timestamp: new Date("2026-09-27T04:00:00Z"), tagName: "Elicea", text: null },
    ])
    const r = await call("get_oura_tags", { startDate: "2026-09-27", endDate: "2026-09-27" })
    expect((r.json as Record<string, { time: string }[]>)["2026-09-27"][0].time).toBe("06:00")
  })

  it("get_phone_day: the phone-detected night carries its local clock time", async () => {
    // The night block beside it is local ("23:40"); a bare UTC ISO string
    // there read as a 00:05 bedtime for a night that began at 02:05.
    phoneDay.phoneDaySummary.mockResolvedValue({
      date: "2026-09-27", night: { phoneDownAt: "23:40" },
      phoneDetectedSleep: [{ day: "2026-09-27", minutes: 276, label: "4h 36m", start: "2026-09-27T00:05:00.000Z", end: "2026-09-27T04:41:00.000Z" }],
    })
    const r = await call("get_phone_day", { date: "2026-09-27" })
    expect((r.json as { phoneDetectedSleep: object[] }).phoneDetectedSleep[0]).toMatchObject({ startLocal: "02:05", endLocal: "06:41" })
  })

  it("get_daily_briefing: local-day windows for drinks and focus, local tag times", async () => {
    db.ouraTag.findMany.mockResolvedValue([
      { timestamp: new Date("2026-09-27T19:00:00Z"), tagName: "Melatonin", text: null },
    ])
    const r = await call("get_daily_briefing")
    expect(iso(arg(db.intakeLog.findMany).where.loggedAt.gte)).toBe(DAY_START)
    expect(iso(arg(db.focusSession.findMany).where.endedAt.lte)).toBe(DAY_END)
    expect((r.json as { oura_tags: { time: string }[] }).oura_tags[0].time).toBe("21:00")
  })
})

// ─── Habits ───────────────────────────────────────────────────────────────────

const day = (s: string) => ({ date: new Date(s + "T00:00:00Z") })
const daysBack = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(from + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - i); return d.toISOString().slice(0, 10)
  })

describe("habit tools respect the range and the schedule", () => {
  it("the completion rate divides by the days in the range, not by 7", async () => {
    // 24 ticks over 30 days read "343%"; 3 of 3 days read "43%".
    db.habit.findMany.mockResolvedValue([{
      id: "h", name: "Walk", scheduleDays: [], timesPerWeek: null, skips: [],
      completions: daysBack("2026-09-24", 24).map(day),
    }])
    let r = await call("get_habit_completions", { startDate: "2026-08-28", endDate: "2026-09-26" })
    expect((r.json as { rate: string }[])[0].rate).toBe("80%")

    db.habit.findMany.mockResolvedValue([{
      id: "h", name: "Walk", scheduleDays: [], timesPerWeek: null, skips: [],
      completions: ["2026-09-24", "2026-09-25", "2026-09-26"].map(day),
    }])
    r = await call("get_habit_completions", { startDate: "2026-09-24", endDate: "2026-09-26" })
    expect((r.json as { rate: string }[])[0].rate).toBe("100%")
  })

  it("a Mon/Wed/Fri habit done every due day is 100%, not 43%", async () => {
    db.habit.findMany.mockResolvedValue([{
      id: "h", name: "Gym", scheduleDays: [1, 3, 5], timesPerWeek: null, skips: [],
      completions: ["2026-09-21", "2026-09-23", "2026-09-25"].map(day),
    }])
    const r = await call("get_habit_completions", { startDate: "2026-09-21", endDate: "2026-09-27" })
    expect((r.json as { rate: string }[])[0].rate).toBe("100%")
  })

  it("get_habits returns the streak its description promises", async () => {
    db.habit.findMany.mockResolvedValue([{
      id: "h", name: "Meditation", color: "#000", scheduleDays: [], timesPerWeek: null, skips: [],
      completions: daysBack("2026-09-27", 5).map(day),
    }])
    const r = await call("get_habits")
    expect((r.json as object[])[0]).toMatchObject({ name: "Meditation", completed_today: true, streak: 5, streak_unit: "days" })
  })

  it("the briefing counts only habits due that day", async () => {
    // On a Tuesday a Mon/Wed/Fri habit was counted as not done: "2/5 habits".
    db.habit.findMany.mockResolvedValue([
      { id: "a", name: "Walk", scheduleDays: [], timesPerWeek: null, completions: [day("2026-09-22")], skips: [] },
      { id: "b", name: "Gym", scheduleDays: [1, 3, 5], timesPerWeek: null, completions: [day("2026-09-21")], skips: [] },
    ])
    const r = await call("get_daily_briefing", { date: "2026-09-22" })
    const habits = (r.json as { habits: { completed: number; total: number; list: { name: string }[] } }).habits
    expect(habits).toMatchObject({ completed: 1, total: 1 })
    expect(habits.list.map(h => h.name)).toEqual(["Walk"])
  })

  it("the briefing reports a skipped habit as skipped, not as left undone", async () => {
    // The app's tile counts a skip toward done/due; "1 of 2 done" with no
    // mention of the skip read as a missed habit.
    db.habit.findMany.mockResolvedValue([
      { id: "a", name: "Walk", scheduleDays: [], timesPerWeek: null, completions: [day("2026-09-22")], skips: [] },
      { id: "b", name: "Run", scheduleDays: [], timesPerWeek: null, completions: [], skips: [day("2026-09-22")] },
    ])
    const r = await call("get_daily_briefing", { date: "2026-09-22" })
    const habits = (r.json as { habits: { completed: number; skipped: number; total: number; list: { name: string; skipped: boolean }[] } }).habits
    expect(habits).toMatchObject({ completed: 1, skipped: 1, total: 2 })
    expect(habits.list.find(h => h.name === "Run")?.skipped).toBe(true)
  })

  it("vacation days are not counted as missed in the completion rate", async () => {
    // The streak on the Habits page freezes over vacation; the rate read
    // those days as misses and halved.
    db.$queryRaw.mockResolvedValue([{ value: JSON.stringify({ active: true, from: "2026-09-21", until: "2026-09-23" }) }])
    db.habit.findMany.mockResolvedValue([{
      id: "h", name: "Walk", scheduleDays: [], timesPerWeek: null, skips: [],
      completions: ["2026-09-24", "2026-09-25", "2026-09-26"].map(day),
    }])
    const r = await call("get_habit_completions", { startDate: "2026-09-21", endDate: "2026-09-26" })
    expect((r.json as { rate: string }[])[0].rate).toBe("100%")
  })
})

// ─── Health readings ─────────────────────────────────────────────────────────

describe("health tools read what the app stored, and absent is not zero", () => {
  it("get_daily_summary reads HealthLog: phone steps count, missing values stay null", async () => {
    // It read Oura live: a ring on the charger all day answered 0 steps, 0 kcal
    // and 0 m while the phone had logged 9,000 — and with no Oura token it threw.
    db.healthLog.findUnique.mockResolvedValue({
      date: new Date("2026-09-26T00:00:00Z"), steps: 9000, caloriesBurned: null, distanceKm: null,
      restingHR: null, sleepDuration: null, hrv: null,
    })
    const r = await call("get_daily_summary", { date: "2026-09-26" })
    expect(r.isError).toBe(false)
    expect(r.json).toMatchObject({ date: "2026-09-26", steps: 9000, caloriesBurned: null, distanceMeters: null })
  })

  it("get_steps / get_calories / get_distance / get_heart_rate keep a null a null", async () => {
    db.healthLog.findMany.mockResolvedValue([
      { date: new Date("2026-09-25T00:00:00Z"), steps: 7000, caloriesBurned: 300, distanceKm: 5.2, restingHR: 55 },
      { date: new Date("2026-09-26T00:00:00Z"), steps: null, caloriesBurned: null, distanceKm: null, restingHR: null },
    ])
    const steps = (await call("get_steps", { startDate: "2026-09-25", endDate: "2026-09-26" })).json
    expect(steps).toEqual([{ date: "2026-09-25", steps: 7000 }, { date: "2026-09-26", steps: null }])
    const dist = (await call("get_distance", { startDate: "2026-09-25", endDate: "2026-09-26" })).json
    expect(dist).toEqual([{ date: "2026-09-25", distanceMeters: 5200 }, { date: "2026-09-26", distanceMeters: null }])
    const cal = (await call("get_calories", { startDate: "2026-09-25", endDate: "2026-09-26" })).json
    expect(cal).toEqual([{ date: "2026-09-25", calories: 300 }, { date: "2026-09-26", calories: null }])
    const hr = (await call("get_heart_rate", { startDate: "2026-09-25", endDate: "2026-09-26" })).json
    expect(hr).toEqual([{ date: "2026-09-25", restingHR: 55 }, { date: "2026-09-26", restingHR: null }])
  })

  it("get_weight returns the weigh-ins from both tables", async () => {
    // A stub that always returned [], so "how has my weight moved?" was
    // answered "no weight data".
    db.healthLog.findMany.mockResolvedValue([
      { date: new Date("2026-09-20T00:00:00Z"), weight: 81.2 },
      { date: new Date("2026-08-01T00:00:00Z"), weight: 83 },
    ])
    db.bodyMeasurement.findMany.mockResolvedValue([{ date: new Date("2026-09-24T00:00:00Z"), weightKg: 80.9 }])
    const r = await call("get_weight", { startDate: "2026-09-01", endDate: "2026-09-27" })
    expect(r.json).toEqual([{ date: "2026-09-20", kg: 81.2 }, { date: "2026-09-24", kg: 80.9 }])
  })

  it("get_sleep drops a ring-off fragment instead of calling it a night", async () => {
    db.ouraToken.findUnique.mockResolvedValue({ accessToken: "t", refreshToken: "r" })
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [
      { day: "2026-09-17", type: "long_sleep", total_sleep_duration: 540, average_hrv: null, average_breath: null },
      { day: "2026-09-18", type: "long_sleep", total_sleep_duration: 26000, average_hrv: 40, average_breath: 14 },
    ] }), { status: 200 }))
    const r = await call("get_sleep", { startDate: "2026-09-17", endDate: "2026-09-18" })
    expect((r.json as { date: string }[]).map(n => n.date)).toEqual(["2026-09-18"])
  })

  it("get_activity_sessions reads Oura's real workout fields", async () => {
    // It read `title` and `duration`, which the workout document does not have:
    // every session was "Workout" with no duration, and the same hour recorded
    // twice could not be told apart.
    db.ouraToken.findUnique.mockResolvedValue({ accessToken: "t", refreshToken: "r" })
    const w = {
      day: "2026-09-17", activity: "cycling", calories: 400, distance: 20000, intensity: "moderate",
      start_datetime: "2026-09-17T17:00:00+02:00", end_datetime: "2026-09-17T18:00:00+02:00",
    }
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [
      { ...w, id: "1", label: null, source: "autodetected" },
      { ...w, id: "2", label: "Evening ride", source: "confirmed" },
    ] }), { status: 200 }))
    const r = await call("get_activity_sessions", { startDate: "2026-09-17", endDate: "2026-09-17" })
    const s = r.json as { id: string; name: string; durationMinutes: number; source: string }[]
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ id: "2", name: "Evening ride", durationMinutes: 60, source: "confirmed" })
  })
})

// ─── Places ──────────────────────────────────────────────────────────────────

describe("get_location_correlations reads the night after a visit", () => {
  it("an evening gym visit followed by longer nights reads as longer sleep", async () => {
    // HealthLog.date is the morning a night ends on. Reading the visit day's
    // row compared the night BEFORE the gym, and the longer post-gym nights
    // landed in the baseline — so the gym came out as shorter sleep.
    const visits = ["2026-09-01", "2026-09-03", "2026-09-05", "2026-09-07", "2026-09-09", "2026-09-11"]
    db.$queryRaw.mockImplementation(async (...a: unknown[]) => {
      const sql = (a[0] as string[]).join("?")
      if (sql.includes(`"SavedPlace"`)) return [{ id: "gym", name: "Gym", emoji: "🏋" }]
      if (sql.includes(`"savedPlaceId"`)) return visits.map(v => ({ checkedAt: new Date(v + "T18:00:00Z") }))
      // Every day was tracked (a morning at home), so every non-gym night is baseline.
      if (sql.includes(`"CheckIn"`)) return Array.from({ length: 14 }, (_, i) => ({ checkedAt: new Date(`2026-09-${String(i + 1).padStart(2, "0")}T07:00:00Z`) }))
      return []
    })
    const nightsAfter = new Set(visits.map(v => `2026-09-${String(Number(v.slice(8)) + 1).padStart(2, "0")}`))
    db.healthLog.findMany.mockResolvedValue(Array.from({ length: 14 }, (_, i) => {
      const d = `2026-09-${String(i + 1).padStart(2, "0")}`
      return { date: new Date(d + "T00:00:00Z"), sleepDuration: nightsAfter.has(d) ? 480 : 440, readinessScore: null, hrv: null, steps: null, restingHR: null }
    }))
    const r = await call("get_location_correlations")
    const place = (r.json as { places: { deltas: { sleep_hours: number } }[] }).places[0]
    expect(place.deltas.sleep_hours).toBeGreaterThan(0)
  })
})

// ─── Standing guards ─────────────────────────────────────────────────────────

const code = (f: string) =>
  readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(join(dir, e.name))
    return /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
  })

describe("standing guards for the connector", () => {
  it("the MCP route prints no UTC clock time", () => {
    // `.toISOString().slice(11, 16)` is the UTC wall clock: a 16:30 coffee
    // reported as 14:30, which is the direction that makes late caffeine
    // look harmless.
    expect(code("src/app/api/mcp/route.ts")).not.toMatch(/toISOString\(\)\.slice\(11/)
  })

  it("Emergy's get_phone_day gives the phone's night in local time", () => {
    // It sliced the ISO string and labelled it UTC — honest, but a model reads
    // "(00:05–04:41 UTC)" back to someone in Prague as a 00:05 bedtime.
    expect(code("src/lib/claude.ts")).not.toMatch(/\.(start|end)\.slice\(11, ?16\)/)
  })

  it("the MCP route never bounds a timestamp column with a date-column helper", () => {
    expect(code("src/app/api/mcp/route.ts")).not.toMatch(
      /(loggedAt|endedAt|startedAt|createdAt|timestamp)\s*:\s*\{\s*gte:\s*(startOfDay|dateColumn)/)
  })

  it("only lib/reminders marks a reminder done", () => {
    // Every surface that flipped isCompleted itself ended a repeating series.
    const writers = walk("src")
      .filter(f => !f.endsWith(join("lib", "reminders.ts")))
      .filter(f => /isCompleted:\s*true,\s*completedAt/.test(code(f)))
    expect(writers).toEqual([])
  })
})
