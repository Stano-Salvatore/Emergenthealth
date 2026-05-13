import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { prisma } from "@/lib/prisma"

type HealthLog = {
  id: string
  date: Date
  sleepDuration: number | null
  deepSleep: number | null
  remSleep: number | null
  lightSleep: number | null
  steps: number | null
  caloriesBurned: number | null
  activeMinutes: number | null
  restingHR: number | null
  weight: number | null
  workouts: unknown
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function toHours(min: number | null) {
  return min != null ? Math.round((min / 60) * 10) / 10 : null
}

function avg(vals: (number | null)[]): number | null {
  const clean = vals.filter((v): v is number => v != null)
  return clean.length ? Math.round(clean.reduce((a, b) => a + b, 0) / clean.length) : null
}

function rowToDay(r: HealthLog) {
  return {
    date: fmtDate(r.date),
    sleep_hours: toHours(r.sleepDuration),
    deep_min: r.deepSleep,
    rem_min: r.remSleep,
    light_min: r.lightSleep,
    steps: r.steps,
    calories_burned: r.caloriesBurned,
    active_minutes: r.activeMinutes,
    resting_hr: r.restingHR,
    weight_kg: r.weight,
  }
}

// Resolves to a userId. Uses MCP_USER_EMAIL env var or falls back to the first user.
async function resolveUserId(hint?: string): Promise<string | null> {
  const email = hint ?? process.env.MCP_USER_EMAIL
  if (email) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    return u?.id ?? null
  }
  const first = await prisma.user.findFirst({ select: { id: true } })
  return first?.id ?? null
}

async function getLogs(userId: string, days: number): Promise<HealthLog[]> {
  return prisma.healthLog.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: Math.min(days, 90),
    select: {
      id: true, date: true, sleepDuration: true, deepSleep: true,
      remSleep: true, lightSleep: true, steps: true, caloriesBurned: true,
      activeMinutes: true, restingHR: true, weight: true, workouts: true,
    },
  }) as Promise<HealthLog[]>
}

export function createHealthMcpServer(): McpServer {
  const server = new McpServer({ name: "smartwatch-health", version: "1.0.0" })

  // ── health_today ────────────────────────────────────────────────────────────
  server.tool("health_today",
    "Get the most recent day's smartwatch metrics: sleep (total, deep, REM, light), steps, active minutes, calories, resting heart rate, and weight.",
    {},
    async () => {
      const userId = await resolveUserId()
      if (!userId) return { content: [{ type: "text", text: "No users found in database." }] }

      const rows = await getLogs(userId, 1)
      if (!rows.length) return { content: [{ type: "text", text: "No health data yet." }] }

      const r = rows[0]
      const result = {
        date: fmtDate(r.date),
        sleep: { total_hours: toHours(r.sleepDuration), deep_min: r.deepSleep, rem_min: r.remSleep, light_min: r.lightSleep },
        activity: { steps: r.steps, calories_burned: r.caloriesBurned, active_minutes: r.activeMinutes },
        heart_rate: { resting_bpm: r.restingHR },
        weight_kg: r.weight,
        workouts: r.workouts,
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }
  )

  // ── health_history ──────────────────────────────────────────────────────────
  server.tool("health_history",
    "Get per-day health data across multiple days.",
    { days: z.number().int().min(1).max(90).default(7).describe("Days to fetch (1–90, default 7)") },
    async ({ days }) => {
      const userId = await resolveUserId()
      if (!userId) return { content: [{ type: "text", text: "No users found." }] }
      const rows = await getLogs(userId, days)
      return { content: [{ type: "text", text: JSON.stringify(rows.map(rowToDay), null, 2) }] }
    }
  )

  // ── health_sleep ────────────────────────────────────────────────────────────
  server.tool("health_sleep",
    "Detailed sleep analysis: totals, deep/REM/light breakdown, and averages.",
    { days: z.number().int().min(1).max(90).default(14).describe("Days to analyse (default 14)") },
    async ({ days }) => {
      const userId = await resolveUserId()
      if (!userId) return { content: [{ type: "text", text: "No users found." }] }
      const rows = await getLogs(userId, days)

      const daily = rows.map(r => ({
        date: fmtDate(r.date),
        total_hours: toHours(r.sleepDuration),
        deep_min: r.deepSleep,
        rem_min: r.remSleep,
        light_min: r.lightSleep,
      }))

      const withData = daily.filter(d => d.total_hours != null)
      const result = {
        period_days: days,
        days_with_data: withData.length,
        avg_total_hours: (() => {
          const v = avg(withData.map(d => d.total_hours != null ? Math.round(d.total_hours * 60) : null))
          return v != null ? Math.round(v / 60 * 10) / 10 : null
        })(),
        avg_deep_min: avg(daily.map(d => d.deep_min)),
        avg_rem_min: avg(daily.map(d => d.rem_min)),
        avg_light_min: avg(daily.map(d => d.light_min)),
        daily,
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }
  )

  // ── health_activity ─────────────────────────────────────────────────────────
  server.tool("health_activity",
    "Steps, calories, and active minutes with averages and totals.",
    { days: z.number().int().min(1).max(90).default(7).describe("Days to cover (default 7)") },
    async ({ days }) => {
      const userId = await resolveUserId()
      if (!userId) return { content: [{ type: "text", text: "No users found." }] }
      const rows = await getLogs(userId, days)

      const daily = rows.map(r => ({
        date: fmtDate(r.date),
        steps: r.steps,
        calories: r.caloriesBurned,
        active_minutes: r.activeMinutes,
      }))

      const result = {
        period_days: days,
        avg_steps: avg(daily.map(d => d.steps)),
        avg_calories: avg(daily.map(d => d.calories)),
        avg_active_minutes: avg(daily.map(d => d.active_minutes)),
        total_steps: daily.reduce((s, d) => s + (d.steps ?? 0), 0) || null,
        daily,
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }
  )

  // ── health_heart_rate ───────────────────────────────────────────────────────
  server.tool("health_heart_rate",
    "Resting heart rate trends: daily values, average, min, max.",
    { days: z.number().int().min(1).max(90).default(14).describe("Days to cover (default 14)") },
    async ({ days }) => {
      const userId = await resolveUserId()
      if (!userId) return { content: [{ type: "text", text: "No users found." }] }
      const rows = await getLogs(userId, days)

      const daily = rows.map(r => ({ date: fmtDate(r.date), resting_hr: r.restingHR }))
      const hrVals = daily.map(d => d.resting_hr).filter((v): v is number => v != null)

      const result = {
        period_days: days,
        days_with_data: hrVals.length,
        avg_resting_hr: avg(daily.map(d => d.resting_hr)),
        min_resting_hr: hrVals.length ? Math.min(...hrVals) : null,
        max_resting_hr: hrVals.length ? Math.max(...hrVals) : null,
        daily,
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }
  )

  // ── health_date_range ───────────────────────────────────────────────────────
  server.tool("health_date_range",
    "Health data for a specific date range.",
    {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date YYYY-MM-DD"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("End date YYYY-MM-DD"),
    },
    async ({ from, to }) => {
      const userId = await resolveUserId()
      if (!userId) return { content: [{ type: "text", text: "No users found." }] }

      const rows = await prisma.healthLog.findMany({
        where: { userId, date: { gte: new Date(from), lte: new Date(to) } },
        orderBy: { date: "desc" },
        select: {
          id: true, date: true, sleepDuration: true, deepSleep: true,
          remSleep: true, lightSleep: true, steps: true, caloriesBurned: true,
          activeMinutes: true, restingHR: true, weight: true, workouts: true,
        },
      }) as HealthLog[]

      if (!rows.length) return { content: [{ type: "text", text: `No data between ${from} and ${to}.` }] }
      return { content: [{ type: "text", text: JSON.stringify(rows.map(rowToDay), null, 2) }] }
    }
  )

  // ── health_log ──────────────────────────────────────────────────────────────
  server.tool("health_log",
    "Write or correct a health entry for a given date. Requires MCP_WRITE_API_KEY to be set on the server.",
    {
      write_key: z.string().describe("Must match MCP_WRITE_API_KEY env var"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date YYYY-MM-DD"),
      sleep_hours: z.number().min(0).max(24).optional(),
      deep_sleep_min: z.number().int().min(0).optional(),
      rem_sleep_min: z.number().int().min(0).optional(),
      light_sleep_min: z.number().int().min(0).optional(),
      steps: z.number().int().min(0).optional(),
      calories_burned: z.number().int().min(0).optional(),
      active_minutes: z.number().int().min(0).optional(),
      resting_hr: z.number().int().min(20).max(250).optional(),
      weight_kg: z.number().min(0).max(500).optional(),
    },
    async (args) => {
      const expected = process.env.MCP_WRITE_API_KEY
      if (!expected) return { content: [{ type: "text", text: "health_log disabled: MCP_WRITE_API_KEY not set." }] }
      if (args.write_key !== expected) return { content: [{ type: "text", text: "Invalid write_key." }] }

      const userId = await resolveUserId()
      if (!userId) return { content: [{ type: "text", text: "No users found." }] }

      const dateObj = new Date(args.date)
      dateObj.setUTCHours(0, 0, 0, 0)

      const sleepDuration = args.sleep_hours != null
        ? Math.round(args.sleep_hours * 60)
        : (args.deep_sleep_min ?? 0) + (args.rem_sleep_min ?? 0) + (args.light_sleep_min ?? 0) || undefined

      const log = await prisma.healthLog.upsert({
        where: { userId_date: { userId, date: dateObj } },
        create: {
          userId, date: dateObj,
          sleepDuration, deepSleep: args.deep_sleep_min, remSleep: args.rem_sleep_min,
          lightSleep: args.light_sleep_min, steps: args.steps,
          caloriesBurned: args.calories_burned, activeMinutes: args.active_minutes,
          restingHR: args.resting_hr, weight: args.weight_kg,
        },
        update: {
          sleepDuration, deepSleep: args.deep_sleep_min, remSleep: args.rem_sleep_min,
          lightSleep: args.light_sleep_min, steps: args.steps,
          caloriesBurned: args.calories_burned, activeMinutes: args.active_minutes,
          restingHR: args.resting_hr, weight: args.weight_kg,
          syncedAt: new Date(),
        },
        select: { id: true },
      })

      return { content: [{ type: "text", text: `Saved. Entry ID: ${log.id}` }] }
    }
  )

  return server
}
