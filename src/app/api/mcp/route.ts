import { NextRequest } from "next/server"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import {
  getSteps, getCalories, getHeartRate, getSleep,
  getWeight, getDistance, getActivitySessions, getDailySummary,
} from "@/lib/oura"
import { getStoredToken, getCurrentTimer, getTodayEntries, getProjects, startTimer, stopTimer } from "@/lib/toggl"

export const runtime = "nodejs"

async function resolveUser(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? ""
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim()
    const key = await prisma.mcpApiKey.findUnique({ where: { token } })
    return key?.userId ?? null
  }
  if (auth.startsWith("Basic ")) {
    const decoded = Buffer.from(auth.slice(6), "base64").toString()
    const password = decoded.split(":")[1]
    if (password) {
      const key = await prisma.mcpApiKey.findUnique({ where: { token: password } })
      return key?.userId ?? null
    }
  }
  return null
}

function today() { return new Date().toISOString().slice(0, 10) }
function startOfDay(dateStr: string) { return new Date(dateStr + "T00:00:00.000Z") }
function endOfDay(dateStr: string) { return new Date(dateStr + "T23:59:59.999Z") }
function fmtSec(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}
function msg(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

function buildMcpServer(userId: string): McpServer {
  const server = new McpServer({ name: "emergenthealth", version: "2.0.0" })

  const dateRange = {
    startDate: z.string().describe("Start date YYYY-MM-DD"),
    endDate: z.string().describe("End date YYYY-MM-DD"),
  }

  // ── OURA: Health metrics ───────────────────────────────────────────────────

  server.tool("get_steps", "Daily step counts from Oura Ring", dateRange,
    async ({ startDate, endDate }) => ok(await getSteps(userId, startDate, endDate)))

  server.tool("get_sleep", "Sleep sessions from Oura Ring (duration, stages, HRV, efficiency)", dateRange,
    async ({ startDate, endDate }) => ok(await getSleep(userId, startDate, endDate)))

  server.tool("get_heart_rate", "Daily resting heart rate from Oura Ring", dateRange,
    async ({ startDate, endDate }) => ok(await getHeartRate(userId, startDate, endDate)))

  server.tool("get_calories", "Daily calories burned from Oura Ring", dateRange,
    async ({ startDate, endDate }) => ok(await getCalories(userId, startDate, endDate)))

  server.tool("get_distance", "Daily distance walked/run in meters from Oura Ring", dateRange,
    async ({ startDate, endDate }) => ok(await getDistance(userId, startDate, endDate)))

  server.tool("get_weight", "Body weight measurements from Oura Ring", dateRange,
    async ({ startDate, endDate }) => ok(await getWeight(userId, startDate, endDate)))

  server.tool("get_activity_sessions", "Workout sessions (type, duration, calories) from Oura Ring", dateRange,
    async ({ startDate, endDate }) => ok(await getActivitySessions(userId, startDate, endDate)))

  server.tool("get_daily_summary", "Full health snapshot for one day (steps, sleep, HR, distance)", { date: z.string().describe("YYYY-MM-DD") },
    async ({ date }) => ok(await getDailySummary(userId, date)))

  server.tool(
    "get_health_metrics",
    "Get extended health metrics for a date range: HRV, readiness score, SpO2, skin temperature, stress, breathing rate",
    dateRange,
    async ({ startDate, endDate }) => {
      const logs = await prisma.healthLog.findMany({
        where: { userId, date: { gte: startOfDay(startDate), lte: endOfDay(endDate) } },
        orderBy: { date: "asc" },
        select: {
          date: true, readinessScore: true, hrv: true, spo2: true,
          skinTemp: true, stressHigh: true, recoveryHigh: true, breathingRate: true,
          activityScore: true, sleepEfficiency: true,
        },
      })
      return ok(logs.map(l => ({ ...l, date: l.date.toISOString().slice(0, 10) })))
    },
  )

  // ── FINANCE ───────────────────────────────────────────────────────────────

  server.tool(
    "get_transactions",
    "Get financial transactions for a date range, optionally filtered by category",
    { ...dateRange, category: z.string().optional().describe("Filter by category name, e.g. 'Food', 'Transport'") },
    async ({ startDate, endDate, category }) => {
      const txns = await prisma.transaction.findMany({
        where: {
          userId,
          date: { gte: startOfDay(startDate), lte: endOfDay(endDate) },
          ...(category ? { category: { contains: category, mode: "insensitive" } } : {}),
        },
        orderBy: { date: "desc" },
        take: 100,
      })
      return ok(txns.map(t => ({
        date: t.date.toISOString().slice(0, 10),
        payee: t.payee,
        amount: (t.amount / 100).toFixed(2),
        category: t.category,
        accountName: t.accountName,
      })))
    },
  )

  server.tool(
    "get_spending_by_category",
    "Get total spending grouped by category for a date range",
    dateRange,
    async ({ startDate, endDate }) => {
      const txns = await prisma.transaction.findMany({
        where: {
          userId,
          date: { gte: startOfDay(startDate), lte: endOfDay(endDate) },
          amount: { lt: 0 },
          isTransfer: false,
        },
      })
      const byCat: Record<string, number> = {}
      for (const t of txns) {
        const cat = t.category ?? "Uncategorised"
        byCat[cat] = (byCat[cat] ?? 0) + Math.abs(t.amount)
      }
      const sorted = Object.entries(byCat)
        .sort((a, b) => b[1] - a[1])
        .map(([category, cents]) => ({ category, total: `€${(cents / 100).toFixed(2)}` }))
      const grandTotal = txns.reduce((s, t) => s + Math.abs(t.amount), 0)
      return ok({ total: `€${(grandTotal / 100).toFixed(2)}`, by_category: sorted })
    },
  )

  // ── HABITS ────────────────────────────────────────────────────────────────

  server.tool(
    "get_habits",
    "List all habits with today's completion status and current streak",
    {},
    async () => {
      const todayDate = startOfDay(today())
      const habits = await prisma.habit.findMany({
        where: { userId, isArchived: false },
        include: {
          completions: {
            where: { date: { gte: todayDate } },
            orderBy: { date: "desc" },
            take: 1,
          },
        },
        orderBy: { createdAt: "asc" },
      })

      const result = habits.map(h => ({
        id: h.id,
        name: h.name,
        color: h.color,
        completed_today: h.completions.length > 0,
      }))
      return ok(result)
    },
  )

  server.tool(
    "complete_habit",
    "Mark a habit as completed for today. Use the habit name (partial match is fine).",
    { habit_name: z.string().describe("Name of the habit to mark complete, e.g. 'meditation', 'exercise'") },
    async ({ habit_name }) => {
      const habits = await prisma.habit.findMany({
        where: { userId, isArchived: false, name: { contains: habit_name, mode: "insensitive" } },
      })
      if (!habits.length) return msg(`No habit found matching "${habit_name}". Use get_habits to see all habits.`)
      const habit = habits[0]
      const todayDate = startOfDay(today())
      await prisma.habitCompletion.upsert({
        where: { habitId_date: { habitId: habit.id, date: todayDate } },
        create: { habitId: habit.id, userId, date: todayDate },
        update: {},
      })
      return msg(`✓ Marked "${habit.name}" as complete for today.`)
    },
  )

  server.tool(
    "get_habit_completions",
    "Get habit completion records for a date range",
    dateRange,
    async ({ startDate, endDate }) => {
      const habits = await prisma.habit.findMany({
        where: { userId, isArchived: false },
        include: {
          completions: {
            where: { date: { gte: startOfDay(startDate), lte: endOfDay(endDate) } },
            orderBy: { date: "asc" },
          },
        },
      })
      return ok(habits.map(h => ({
        habit: h.name,
        completions: h.completions.map(c => c.date.toISOString().slice(0, 10)),
        rate: `${Math.round((h.completions.length / 7) * 100)}%`,
      })))
    },
  )

  // ── JOURNAL / DAILY NOTES ─────────────────────────────────────────────────

  server.tool(
    "get_journal",
    "Read the journal/daily note for a specific date",
    { date: z.string().describe("YYYY-MM-DD, or 'today'") },
    async ({ date }) => {
      const d = date === "today" ? today() : date
      const note = await prisma.dailyNote.findUnique({
        where: { userId_date: { userId, date: startOfDay(d) } },
      })
      if (!note) return msg(`No journal entry for ${d}.`)
      return ok({ date: d, content: note.content })
    },
  )

  server.tool(
    "write_journal",
    "Write or update the journal/daily note for today. Replaces the existing entry.",
    { content: z.string().describe("The journal entry text to save") },
    async ({ content }) => {
      const date = startOfDay(today())
      await prisma.dailyNote.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, content },
        update: { content },
      })
      return msg("Journal entry saved for today.")
    },
  )

  // ── REMINDERS ─────────────────────────────────────────────────────────────

  server.tool(
    "get_reminders",
    "Get active (incomplete) reminders, optionally including completed ones",
    { include_completed: z.boolean().optional().describe("Set true to include completed reminders") },
    async ({ include_completed }) => {
      const reminders = await prisma.reminder.findMany({
        where: { userId, ...(include_completed ? {} : { isCompleted: false }) },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: 30,
      })
      return ok(reminders.map(r => ({
        id: r.id,
        title: r.title,
        due: r.dueDate?.toISOString().slice(0, 10) ?? null,
        priority: r.priority,
        done: r.isCompleted,
      })))
    },
  )

  server.tool(
    "create_reminder",
    "Create a new reminder or task",
    {
      title: z.string().describe("What to remember"),
      due_date: z.string().optional().describe("Optional due date in YYYY-MM-DD format"),
      reminder_time: z.string().optional().describe("Optional time for notification in HH:MM (24h) format"),
      priority: z.enum(["low", "normal", "high"]).optional().describe("Priority level, default is normal"),
    },
    async ({ title, due_date, reminder_time, priority }) => {
      const reminder = await prisma.reminder.create({
        data: {
          userId,
          title,
          dueDate: due_date ? new Date(due_date) : null,
          reminderTime: reminder_time ?? null,
          priority: priority ?? "normal",
          tags: [],
        },
      })
      return msg(`Reminder created: "${reminder.title}"${due_date ? ` (due ${due_date}${reminder_time ? ` at ${reminder_time}` : ""})` : ""}`)
    },
  )

  server.tool(
    "complete_reminder",
    "Mark a reminder as done by matching its title",
    { title: z.string().describe("Title of the reminder to complete (partial match)") },
    async ({ title }) => {
      const reminders = await prisma.reminder.findMany({
        where: { userId, isCompleted: false, title: { contains: title, mode: "insensitive" } },
      })
      if (!reminders.length) return msg(`No active reminder matching "${title}".`)
      await prisma.reminder.update({
        where: { id: reminders[0].id },
        data: { isCompleted: true, completedAt: new Date() },
      })
      return msg(`✓ Marked "${reminders[0].title}" as done.`)
    },
  )

  // ── MOOD ──────────────────────────────────────────────────────────────────

  server.tool(
    "log_mood",
    "Log today's mood on a 1-5 scale (1=awful, 2=bad, 3=okay, 4=good, 5=great)",
    {
      mood: z.number().int().min(1).max(5).describe("Mood score 1-5"),
      note: z.string().optional().describe("Optional note about the mood"),
    },
    async ({ mood, note }) => {
      const date = startOfDay(today())
      await prisma.moodLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, mood, note: note ?? null },
        update: { mood, note: note ?? null },
      })
      const labels = ["", "Awful", "Bad", "Okay", "Good", "Great"]
      return msg(`Mood logged: ${mood}/5 — ${labels[mood]}${note ? ` (${note})` : ""}`)
    },
  )

  server.tool(
    "get_mood_history",
    "Get mood logs for a date range with scores and notes",
    dateRange,
    async ({ startDate, endDate }) => {
      const logs = await prisma.moodLog.findMany({
        where: { userId, date: { gte: startOfDay(startDate), lte: endOfDay(endDate) } },
        orderBy: { date: "asc" },
      })
      const labels = ["", "Awful", "Bad", "Okay", "Good", "Great"]
      return ok(logs.map(l => ({
        date: l.date.toISOString().slice(0, 10),
        score: l.mood,
        label: labels[l.mood],
        note: l.note,
      })))
    },
  )

  // ── INTAKE ────────────────────────────────────────────────────────────────

  server.tool(
    "log_intake",
    "Log water, coffee, tea, or alcohol intake",
    {
      type: z.enum(["water", "coffee", "tea", "alcohol", "other"]).describe("Type of drink"),
      amount_ml: z.number().describe("Amount in millilitres, e.g. 250 for a glass, 500 for a bottle"),
      note: z.string().optional().describe("Optional note"),
    },
    async ({ type, amount_ml, note }) => {
      await prisma.intakeLog.create({
        data: { userId, type, amountMl: amount_ml, note: note ?? null, loggedAt: new Date() },
      })
      return msg(`Logged ${amount_ml}ml of ${type}.`)
    },
  )

  server.tool(
    "get_intake_today",
    "Get all intake logs for today (water, coffee, etc.)",
    {},
    async () => {
      const todayStart = startOfDay(today())
      const todayEnd = endOfDay(today())
      const logs = await prisma.intakeLog.findMany({
        where: { userId, loggedAt: { gte: todayStart, lte: todayEnd } },
        orderBy: { loggedAt: "asc" },
      })
      const totals: Record<string, number> = {}
      for (const l of logs) totals[l.type] = (totals[l.type] ?? 0) + l.amountMl
      return ok({
        entries: logs.map(l => ({ type: l.type, amount_ml: l.amountMl, note: l.note, time: l.loggedAt.toISOString().slice(11, 16) })),
        totals_ml: totals,
        water_glasses: Math.round((totals.water ?? 0) / 250 * 10) / 10,
      })
    },
  )

  // ── READING ───────────────────────────────────────────────────────────────

  server.tool(
    "get_books",
    "Get the reading list filtered by status: currently reading, done, or wishlist",
    { status: z.enum(["reading", "done", "wishlist", "all"]).optional().describe("Filter by status, default shows all") },
    async ({ status }) => {
      const books = await prisma.book.findMany({
        where: { userId, ...(status && status !== "all" ? { status } : {}) },
        orderBy: { updatedAt: "desc" },
        take: 30,
      })
      return ok(books.map(b => ({
        title: b.title,
        author: b.author,
        status: b.status,
        pages: b.pages,
        rating: b.rating,
        started: b.startedAt?.toISOString().slice(0, 10),
        finished: b.finishedAt?.toISOString().slice(0, 10),
      })))
    },
  )

  // ── FOCUS SESSIONS ────────────────────────────────────────────────────────

  server.tool(
    "log_focus_session",
    "Log a completed focus or Pomodoro session",
    {
      duration_min: z.number().describe("Duration of the session in minutes"),
      label: z.string().optional().describe("What you focused on, e.g. 'coding', 'writing'"),
    },
    async ({ duration_min, label }) => {
      const now = new Date()
      await prisma.focusSession.create({
        data: {
          userId,
          durationMin: duration_min,
          type: "focus",
          label: label ?? null,
          startedAt: new Date(now.getTime() - duration_min * 60_000),
          endedAt: now,
        },
      })
      return msg(`Focus session logged: ${duration_min}min${label ? ` — ${label}` : ""}.`)
    },
  )

  server.tool(
    "get_focus_sessions",
    "Get focus sessions for a date range with total focused time",
    dateRange,
    async ({ startDate, endDate }) => {
      const sessions = await prisma.focusSession.findMany({
        where: { userId, endedAt: { gte: startOfDay(startDate), lte: endOfDay(endDate) } },
        orderBy: { endedAt: "desc" },
      })
      const totalMin = sessions.reduce((s, f) => s + f.durationMin, 0)
      return ok({
        total_focused: `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`,
        sessions: sessions.map(f => ({
          label: f.label,
          duration_min: f.durationMin,
          date: f.endedAt.toISOString().slice(0, 10),
          time: f.endedAt.toISOString().slice(11, 16),
        })),
      })
    },
  )

  // ── TOGGL TRACK ───────────────────────────────────────────────────────────

  server.tool("toggl_current_timer", "Get the currently running Toggl timer", {},
    async () => {
      const stored = await getStoredToken(userId)
      if (!stored) return msg("Toggl not connected. Add your API token in the app.")
      const current = await getCurrentTimer(stored.apiToken)
      if (!current) return msg("No timer is running.")
      const elapsed = Math.floor((Date.now() - new Date(current.start).getTime()) / 1000)
      return ok({ id: current.id, description: current.description, started_at: current.start, elapsed: fmtSec(elapsed), elapsed_seconds: elapsed })
    },
  )

  server.tool(
    "toggl_start_timer",
    "Start a new Toggl time entry",
    {
      description: z.string().describe("What you are working on"),
      project_name: z.string().optional().describe("Optional project name to match"),
    },
    async ({ description, project_name }) => {
      const stored = await getStoredToken(userId)
      if (!stored?.workspaceId) return msg("Toggl not connected.")
      let projectId: number | null = null
      if (project_name) {
        const projects = await getProjects(stored.apiToken, stored.workspaceId)
        projectId = projects.find(p => p.name.toLowerCase().includes(project_name.toLowerCase()))?.id ?? null
      }
      const entry = await startTimer(stored.apiToken, stored.workspaceId, description, projectId)
      return msg(`Timer started: "${entry.description}". ID: ${entry.id}`)
    },
  )

  server.tool("toggl_stop_timer", "Stop the currently running Toggl timer", {},
    async () => {
      const stored = await getStoredToken(userId)
      if (!stored?.workspaceId) return msg("Toggl not connected.")
      const current = await getCurrentTimer(stored.apiToken)
      if (!current) return msg("No timer is running.")
      const stopped = await stopTimer(stored.apiToken, stored.workspaceId, current.id)
      return msg(`Timer stopped: "${stopped.description}". Duration: ${fmtSec(stopped.duration)}`)
    },
  )

  server.tool("toggl_today_entries", "All Toggl time entries logged today", {},
    async () => {
      const stored = await getStoredToken(userId)
      if (!stored) return msg("Toggl not connected.")
      const [entries, projects] = await Promise.all([
        getTodayEntries(stored.apiToken),
        stored.workspaceId ? getProjects(stored.apiToken, stored.workspaceId) : Promise.resolve([]),
      ])
      const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]))
      const completed = entries.filter(e => e.duration > 0)
      const totalSec = completed.reduce((s, e) => s + e.duration, 0)
      return ok({
        total_today: fmtSec(totalSec),
        entries: completed.map(e => ({
          description: e.description ?? "(no description)",
          project: e.project_id ? (projectMap[e.project_id] ?? null) : null,
          duration: fmtSec(e.duration),
        })),
      })
    },
  )

  server.tool("toggl_projects", "List active Toggl projects", {},
    async () => {
      const stored = await getStoredToken(userId)
      if (!stored?.workspaceId) return msg("Toggl not connected.")
      const projects = await getProjects(stored.apiToken, stored.workspaceId)
      return ok(projects.map(p => ({ id: p.id, name: p.name, color: p.color })))
    },
  )

  // ── DAILY BRIEFING ────────────────────────────────────────────────────────

  server.tool(
    "get_daily_briefing",
    "Get a full personal briefing for today or a specific date: health, habits, reminders, intake, focus, and mood all in one call. Use this when the user asks 'how am I doing today?' or wants a summary.",
    { date: z.string().optional().describe("YYYY-MM-DD, defaults to today") },
    async ({ date }) => {
      const d = date ?? today()
      const todayStart = startOfDay(d)
      const todayEnd = endOfDay(d)

      const [healthLog, habits, reminders, intakeLogs, focusSessions, moodLog] = await Promise.all([
        prisma.healthLog.findUnique({ where: { userId_date: { userId, date: todayStart } } }),
        prisma.habit.findMany({
          where: { userId, isArchived: false },
          include: { completions: { where: { date: todayStart }, take: 1 } },
        }),
        prisma.reminder.findMany({
          where: { userId, isCompleted: false, dueDate: { lte: new Date(d + "T23:59:59Z") } },
          orderBy: { dueDate: "asc" },
          take: 5,
        }),
        prisma.intakeLog.findMany({ where: { userId, loggedAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.focusSession.findMany({ where: { userId, endedAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.moodLog.findUnique({ where: { userId_date: { userId, date: todayStart } } }),
      ])

      const waterMl = intakeLogs.filter(l => l.type === "water").reduce((s, l) => s + l.amountMl, 0)
      const coffeeCups = intakeLogs.filter(l => l.type === "coffee").length
      const focusMin = focusSessions.reduce((s, f) => s + f.durationMin, 0)
      const habitsCompleted = habits.filter(h => h.completions.length > 0).length
      const moodLabels = ["", "Awful", "Bad", "Okay", "Good", "Great"]

      return ok({
        date: d,
        sleep: healthLog ? {
          duration_h: healthLog.sleepDuration ? Math.round(healthLog.sleepDuration / 60 * 10) / 10 : null,
          hrv: healthLog.hrv,
          readiness: healthLog.readinessScore,
          efficiency_pct: healthLog.sleepEfficiency,
        } : null,
        activity: healthLog ? {
          steps: healthLog.steps,
          calories_burned: healthLog.caloriesBurned,
          distance_km: healthLog.distanceKm,
          active_min: healthLog.activeMinutes,
        } : null,
        mood: moodLog ? { score: moodLog.mood, label: moodLabels[moodLog.mood], note: moodLog.note } : null,
        habits: { completed: habitsCompleted, total: habits.length, list: habits.map(h => ({ name: h.name, done: h.completions.length > 0 })) },
        intake: { water_ml: waterMl, water_glasses: Math.round(waterMl / 250 * 10) / 10, coffee_cups: coffeeCups },
        focus: { total_min: focusMin, sessions: focusSessions.length },
        upcoming_reminders: reminders.map(r => ({ title: r.title, due: r.dueDate?.toISOString().slice(0, 10) })),
      })
    },
  )

  return server
}

async function handleMcp(req: NextRequest): Promise<Response> {
  const userId = await resolveUser(req)
  if (!userId) {
    const origin = new URL(req.url).origin
    return new Response(
      JSON.stringify({ error: "Unauthorized. Provide a Bearer token from Settings → MCP Server." }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer realm="${origin}", resource_metadata="${origin}/.well-known/oauth-protected-resource", as_uri="${origin}"`,
        },
      },
    )
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  const server = buildMcpServer(userId)
  await server.connect(transport)
  return transport.handleRequest(req)
}

export const GET = handleMcp
export const POST = handleMcp
export const DELETE = handleMcp
