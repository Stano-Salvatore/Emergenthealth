import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import * as db from "./db.js"

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "smartwatch-health",
    version: "1.0.0",
  })

  // ── health_today ────────────────────────────────────────────────────────────
  server.tool(
    "health_today",
    "Get the most recent day's smartwatch health metrics: sleep (total, deep, REM, light), steps, active minutes, calories burned, resting heart rate, and weight.",
    {},
    async () => {
      const row = await db.getLatestLog()
      if (!row) {
        return { content: [{ type: "text", text: "No health data found in the database yet." }] }
      }

      const date = typeof row.date === "string" ? row.date.slice(0, 10) : new Date(row.date).toISOString().slice(0, 10)
      const result = {
        date,
        sleep: {
          total_hours: row.sleep_duration != null ? Math.round((row.sleep_duration / 60) * 10) / 10 : null,
          deep_min: row.deep_sleep,
          rem_min: row.rem_sleep,
          light_min: row.light_sleep,
        },
        activity: {
          steps: row.steps,
          calories_burned: row.calories_burned,
          active_minutes: row.active_minutes,
        },
        heart_rate: {
          resting_bpm: row.resting_hr,
        },
        weight_kg: row.weight,
        workouts: row.workouts,
        synced_at: row.synced_at,
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }
  )

  // ── health_history ──────────────────────────────────────────────────────────
  server.tool(
    "health_history",
    "Get a full history of smartwatch health data across multiple days, with per-day breakdown of all metrics.",
    {
      days: z.number().int().min(1).max(90).default(7).describe("Number of days to fetch (1–90, default 7)"),
    },
    async ({ days }) => {
      const rows = await db.getLogs(days)
      if (rows.length === 0) {
        return { content: [{ type: "text", text: "No health data found." }] }
      }

      const result = rows.map(r => {
        const date = typeof r.date === "string" ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10)
        return {
          date,
          sleep_hours: r.sleep_duration != null ? Math.round((r.sleep_duration / 60) * 10) / 10 : null,
          deep_min: r.deep_sleep,
          rem_min: r.rem_sleep,
          light_min: r.light_sleep,
          steps: r.steps,
          calories_burned: r.calories_burned,
          active_minutes: r.active_minutes,
          resting_hr: r.resting_hr,
          weight_kg: r.weight,
        }
      })

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }
  )

  // ── health_sleep ────────────────────────────────────────────────────────────
  server.tool(
    "health_sleep",
    "Get a detailed sleep analysis with averages for total sleep, deep sleep, REM, and light sleep across a date range.",
    {
      days: z.number().int().min(1).max(90).default(14).describe("Number of days to analyse (default 14)"),
    },
    async ({ days }) => {
      const rows = await db.getLogs(days)
      const analysis = db.buildSleepAnalysis(rows, days)
      return { content: [{ type: "text", text: JSON.stringify(analysis, null, 2) }] }
    }
  )

  // ── health_activity ─────────────────────────────────────────────────────────
  server.tool(
    "health_activity",
    "Get activity statistics: daily steps, calories burned, and active minutes with rolling averages and totals.",
    {
      days: z.number().int().min(1).max(90).default(7).describe("Number of days to cover (default 7)"),
    },
    async ({ days }) => {
      const rows = await db.getLogs(days)
      const stats = db.buildActivityStats(rows, days)
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] }
    }
  )

  // ── health_heart_rate ───────────────────────────────────────────────────────
  server.tool(
    "health_heart_rate",
    "Get resting heart rate trends: daily values, average, min, and max over a date range.",
    {
      days: z.number().int().min(1).max(90).default(14).describe("Number of days to cover (default 14)"),
    },
    async ({ days }) => {
      const rows = await db.getLogs(days)
      const stats = db.buildHRStats(rows, days)
      return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] }
    }
  )

  // ── health_date_range ───────────────────────────────────────────────────────
  server.tool(
    "health_date_range",
    "Get health data for a specific date range (YYYY-MM-DD format). Useful for querying a specific week or month.",
    {
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date YYYY-MM-DD (inclusive)"),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("End date YYYY-MM-DD (inclusive)"),
    },
    async ({ from, to }) => {
      const rows = await db.getLogsByDateRange(from, to)
      if (rows.length === 0) {
        return { content: [{ type: "text", text: `No data found between ${from} and ${to}.` }] }
      }

      const result = rows.map(r => {
        const date = typeof r.date === "string" ? r.date.slice(0, 10) : new Date(r.date).toISOString().slice(0, 10)
        return {
          date,
          sleep_hours: r.sleep_duration != null ? Math.round((r.sleep_duration / 60) * 10) / 10 : null,
          deep_min: r.deep_sleep,
          rem_min: r.rem_sleep,
          light_min: r.light_sleep,
          steps: r.steps,
          calories_burned: r.calories_burned,
          active_minutes: r.active_minutes,
          resting_hr: r.resting_hr,
          weight_kg: r.weight,
        }
      })

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    }
  )

  // ── health_log ──────────────────────────────────────────────────────────────
  server.tool(
    "health_log",
    "Write (upsert) a health entry for a given date. Use this to manually record or correct health data. Requires a valid user ID or email address.",
    {
      user_id: z.string().min(1).describe("User ID (cuid) or email address of the user"),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date YYYY-MM-DD"),
      sleep_hours: z.number().min(0).max(24).optional().describe("Total sleep in hours (e.g. 7.5)"),
      deep_sleep_min: z.number().int().min(0).optional().describe("Deep sleep in minutes"),
      rem_sleep_min: z.number().int().min(0).optional().describe("REM sleep in minutes"),
      light_sleep_min: z.number().int().min(0).optional().describe("Light sleep in minutes"),
      steps: z.number().int().min(0).optional().describe("Step count"),
      calories_burned: z.number().int().min(0).optional().describe("Calories burned"),
      active_minutes: z.number().int().min(0).optional().describe("Active minutes"),
      resting_hr: z.number().int().min(20).max(250).optional().describe("Resting heart rate (bpm)"),
      weight_kg: z.number().min(0).max(500).optional().describe("Weight in kg"),
    },
    async (args) => {
      const writeKey = process.env.MCP_WRITE_API_KEY
      if (!writeKey) {
        return { content: [{ type: "text", text: "health_log is disabled: MCP_WRITE_API_KEY not set on the server." }] }
      }

      const sleepDuration = args.sleep_hours != null
        ? Math.round(args.sleep_hours * 60)
        : (args.deep_sleep_min ?? 0) + (args.rem_sleep_min ?? 0) + (args.light_sleep_min ?? 0) || undefined

      const row = await db.upsertHealthLog({
        userId: args.user_id,
        date: args.date,
        sleepDuration,
        deepSleep: args.deep_sleep_min,
        remSleep: args.rem_sleep_min,
        lightSleep: args.light_sleep_min,
        steps: args.steps,
        caloriesBurned: args.calories_burned,
        activeMinutes: args.active_minutes,
        restingHR: args.resting_hr,
        weight: args.weight_kg,
      })

      return { content: [{ type: "text", text: `Saved. Entry ID: ${row.id}` }] }
    }
  )

  return server
}
