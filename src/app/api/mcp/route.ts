import { NextRequest } from "next/server"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { recordDrink } from "@/lib/intake-write"
import { getSleep, getActivitySessions } from "@/lib/oura"
import { getStoredToken, getCurrentTimer, getTodayEntries, getProjects, startTimer, stopTimer } from "@/lib/toggl"
import { getUserTimezone, userDay, userToday } from "@/lib/user-timezone"
import { addDaysISO, localDateStr, localTimeStr, zonedDayRange } from "@/lib/local-date"
import { completeReminder } from "@/lib/reminders"
import { parseHhMm, resolveReminderWhen } from "@/lib/reminder-when"
import { loadWeightSeries } from "@/lib/weight-series"
import { habitStreak, isDueOn, isScheduledOn, weekStart } from "@/lib/habit-schedule"
import { getVacationWindow, makeIsFrozen } from "@/lib/streak"
import { loadMoodByDay, moodDay } from "@/lib/mood-series"
import { phoneDaySummary } from "@/lib/phone-day"
import { musicRange } from "@/lib/music-days"
import { estimateHome, summariseDays, detectTrips, awayVsHome, type DayMetrics } from "@/lib/day-location"
import { loadCoarsePoints } from "@/lib/day-location-load"
import { sumHydration } from "@/lib/hydration"
import { drinkCaloriesTotal } from "@/lib/drink-calories"

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

// The user's today, not the server's. Emergy answering "how much did I drink
// today" with yesterday's total between midnight and 02:00 is the whole point
// of this being async.
async function todayFor(userId: string) { return userToday(userId) }
// For @db.Date columns only (HealthLog.date, HabitCompletion.date…), which
// Prisma stores and compares at UTC midnight.
function dateColumn(dateStr: string) { return new Date(dateStr + "T00:00:00.000Z") }
function dateColumnEnd(dateStr: string) { return new Date(dateStr + "T23:59:59.999Z") }
// For timestamp columns (loggedAt, endedAt, createdAt): the instants the
// user's own days start and end. Bounding those with dateColumn cut the day at
// UTC midnight — 02:00 in a Prague summer — so a drink at 00:40 landed on the
// day before.
async function localDays(userId: string, startDate: string, endDate: string = startDate) {
  const tz = await getUserTimezone(userId)
  return { tz, window: { gte: zonedDayRange(tz, startDate).start, lte: zonedDayRange(tz, endDate).end } }
}
const ymdOf = (dateColumnValue: Date) => dateColumnValue.toISOString().slice(0, 10)
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

  // A date the model sends is compared as a string ("2026-9-1" < "2026-09-…"),
  // so an unpadded one matched nothing and came back as "no data".
  const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  const dateRange = {
    startDate: ymd.describe("Start date YYYY-MM-DD"),
    endDate: ymd.describe("End date YYYY-MM-DD"),
  }

  // ── Health metrics ─────────────────────────────────────────────────────────
  // Read from HealthLog, the day as the app stores it: the ring's figures where
  // it recorded them, the phone's where it did not, and imported history. Asking
  // Oura live missed all but the first, turned a day with no document into
  // 0 steps, and threw for anyone without an Oura token.

  const dailyRows = (startDate: string, endDate: string) =>
    prisma.healthLog.findMany({
      where: { userId, date: { gte: dateColumn(startDate), lte: dateColumnEnd(endDate) } },
      orderBy: { date: "asc" },
      select: { date: true, steps: true, caloriesBurned: true, distanceKm: true, restingHR: true },
    })
  const meters = (km: number | null) => (km == null ? null : Math.round(km * 1000))

  server.tool("get_steps", "Daily step counts (ring, or the phone on days the ring wasn't worn). null = no reading that day, not zero steps", dateRange,
    async ({ startDate, endDate }) =>
      ok((await dailyRows(startDate, endDate)).map(r => ({ date: ymdOf(r.date), steps: r.steps }))))

  server.tool("get_sleep", "Sleep sessions from Oura Ring (duration, stages, HRV, efficiency). Ring-off fragments are left out rather than reported as nights", dateRange,
    async ({ startDate, endDate }) => ok(await getSleep(userId, startDate, endDate)))

  server.tool("get_heart_rate", "Daily resting heart rate (bpm). null = no reading that day", dateRange,
    async ({ startDate, endDate }) =>
      ok((await dailyRows(startDate, endDate)).map(r => ({ date: ymdOf(r.date), restingHR: r.restingHR }))))

  server.tool("get_calories", "Daily active calories burned. null = no reading that day, not zero", dateRange,
    async ({ startDate, endDate }) =>
      ok((await dailyRows(startDate, endDate)).map(r => ({ date: ymdOf(r.date), calories: r.caloriesBurned }))))

  server.tool("get_distance", "Daily distance walked/run in meters. null = no reading that day, not zero", dateRange,
    async ({ startDate, endDate }) =>
      ok((await dailyRows(startDate, endDate)).map(r => ({ date: ymdOf(r.date), distanceMeters: meters(r.distanceKm) }))))

  server.tool("get_weight", "Body weight in kg per day, from the quick weight log and Body-page measurements (the measurement wins a day with both)", dateRange,
    async ({ startDate, endDate }) => {
      // loadWeightSeries counts back from now, so size its window to reach startDate.
      const days = Math.max(1, Math.ceil((Date.now() - dateColumn(startDate).getTime()) / 86_400_000) + 1)
      const points = (await loadWeightSeries(userId, days)).filter(p => p.date >= startDate && p.date <= endDate)
      return points.length ? ok(points) : msg(`No weigh-ins between ${startDate} and ${endDate}.`)
    })

  server.tool("get_activity_sessions", "Workout sessions from Oura Ring (activity, label, source, intensity, start/end, duration, calories)", dateRange,
    async ({ startDate, endDate }) => ok(await getActivitySessions(userId, startDate, endDate)))

  server.tool("get_daily_summary", "Health snapshot for one day (steps, active calories, distance, resting HR, sleep minutes, HRV). null = no reading, not zero", { date: ymd.describe("YYYY-MM-DD") },
    async ({ date }) => {
      const l = await prisma.healthLog.findUnique({ where: { userId_date: { userId, date: dateColumn(date) } } })
      if (!l) return msg(`Nothing recorded for ${date}.`)
      return ok({
        date,
        steps: l.steps,
        caloriesBurned: l.caloriesBurned,
        distanceMeters: meters(l.distanceKm),
        restingHR: l.restingHR,
        sleepMinutes: l.sleepDuration,
        hrv: l.hrv,
      })
    })

  server.tool(
    "get_phone_day",
    "What the user's PHONE sensors said about a day: when the phone went quiet for the night and was " +
      "picked up (a bedtime clue, not sleep), pickups after 22:00, evening light level, any phone-detected " +
      "sleep, and how many light/pressure readings and screen events the day produced. This is the phone's " +
      "own instrument panel — use it on nights the ring was off, and always label it as the phone's estimate.",
    { date: ymd.describe("YYYY-MM-DD (defaults to today)").optional() },
    async ({ date }) => {
      const timezone = await getUserTimezone(userId)
      const day = date ?? await todayFor(userId)
      const summary = await phoneDaySummary(userId, day, timezone)
      // The night block is in local clock time; the detected-sleep instants
      // are UTC ISO strings. Side by side, "00:05" out of an ISO string reads
      // as a local bedtime, so each carries its local reading too.
      return ok({
        ...summary,
        phoneDetectedSleep: summary.phoneDetectedSleep.map(n => ({
          ...n,
          startLocal: localTimeStr(timezone, new Date(n.start)),
          endLocal: localTimeStr(timezone, new Date(n.end)),
        })),
      })
    })

  server.tool(
    "get_music",
    "What the user listened to (Last.fm / YouTube Music history): per-day tracks, listening minutes, top artist/track, late-evening tracks, and the range's top artists with plays and genre. Null minutes mean an old import whose minutes were never counted — not silence.",
    dateRange,
    async ({ startDate, endDate }) => ok(await musicRange(userId, startDate, endDate)))

  server.tool(
    "get_oura_tags",
    "Get the user's Oura Ring tags for a date range — manual annotations logged in the Oura app such as coffee, supplements, medication, alcohol. Use this to answer 'did coffee affect my sleep', 'what pills did I take', etc.",
    dateRange,
    async ({ startDate, endDate }) => {
      const tags = await prisma.ouraTag.findMany({
        where: { userId, day: { gte: startDate, lte: endDate } },
        orderBy: { timestamp: "asc" },
        select: { day: true, timestamp: true, tagName: true, text: true },
      }).catch(() => [])
      if (!tags.length) return msg(`No Oura tags between ${startDate} and ${endDate}. (Tags sync from the Oura app — the user logs coffee/meds there.)`)
      const tz = await getUserTimezone(userId)
      const byDay: Record<string, { time: string; tag: string; note: string | null }[]> = {}
      for (const t of tags) {
        const label = (t.tagName ?? t.text ?? "").trim()
        if (!label) continue
        ;(byDay[t.day] ??= []).push({
          time: localTimeStr(tz, t.timestamp),
          tag: label,
          note: t.text && t.text !== label ? t.text : null,
        })
      }
      return ok(byDay)
    },
  )

  server.tool(
    "get_checkins",
    "Get the user's morning check-ins for a date range: energy (1-5), mood (1-5), and daily intention",
    dateRange,
    async ({ startDate, endDate }) => {
      const rows = await prisma.morningCheckIn.findMany({
        where: { userId, date: { gte: startDate, lte: endDate } },
        orderBy: { date: "asc" },
        select: { date: true, energy: true, mood: true, intention: true },
      }).catch(() => [])
      if (!rows.length) return msg(`No morning check-ins between ${startDate} and ${endDate}.`)
      return ok(rows)
    },
  )

  server.tool(
    "get_health_metrics",
    "Get extended health metrics for a date range: HRV, readiness score, SpO2, skin temperature, stress, breathing rate, sleep latency, and Oura's long-range figures (VO2 max, vascular age, pulse wave velocity, resilience)",
    dateRange,
    async ({ startDate, endDate }) => {
      const logs = await prisma.healthLog.findMany({
        where: { userId, date: { gte: dateColumn(startDate), lte: dateColumnEnd(endDate) } },
        orderBy: { date: "asc" },
        // A hand-written list that stopped being updated: sleep latency sat in
        // the database for months unread, and the long-range Oura figures were
        // added to the Health page and to Emergy without ever reaching here.
        // This is the surface other tools read the account through.
        select: {
          date: true, readinessScore: true, hrv: true, spo2: true,
          skinTemp: true, stressHigh: true, recoveryHigh: true, breathingRate: true,
          activityScore: true, sleepEfficiency: true, sleepLatency: true,
          restlessPeriods: true, cardiovascularAge: true, pulseWaveVelocity: true,
          vo2Max: true, resilienceLevel: true, stressSummary: true,
        },
      })
      return ok(logs.map(l => ({ ...l, date: l.date.toISOString().slice(0, 10) })))
    },
  )

  // ── HABITS ────────────────────────────────────────────────────────────────

  server.tool(
    "get_habits",
    "List all habits with today's completion status, whether the schedule asks for it today, and the current streak (in days, or in weeks for an N-times-a-week habit)",
    {},
    async () => {
      const today = await todayFor(userId)
      // As far back as the Habits page reads, so the streak is the one it shows.
      const since = dateColumn(addDaysISO(today, -731))
      const [habits, vacation] = await Promise.all([
        prisma.habit.findMany({
          where: { userId, isArchived: false },
          include: {
            completions: { where: { date: { gte: since } }, select: { date: true } },
            skips: { where: { date: { gte: since } }, select: { date: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        getVacationWindow(userId),
      ])
      const isFrozen = makeIsFrozen(vacation)

      return ok(habits.map(h => {
        const done = new Set(h.completions.map(c => ymdOf(c.date)))
        const skipped = new Set(h.skips.map(s => ymdOf(s.date)))
        const schedule = { scheduleDays: h.scheduleDays, timesPerWeek: h.timesPerWeek }
        const { streak, unit } = habitStreak(schedule, done, skipped, today, isFrozen)
        return {
          id: h.id,
          name: h.name,
          color: h.color,
          completed_today: done.has(today),
          skipped_today: skipped.has(today),
          due_today: isDueOn(schedule, today, done),
          streak,
          streak_unit: unit,
        }
      }))
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
      const todayDate = dateColumn(await todayFor(userId))
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
    "Get habit completion records for a date range, with the share of the days the habit was due that it was done (off-days of its schedule, skipped days and vacation days are not due; days after today are not counted)",
    dateRange,
    async ({ startDate, endDate }) => {
      const range = { gte: dateColumn(startDate), lte: dateColumnEnd(endDate) }
      const [habits, tz, vacation] = await Promise.all([
        prisma.habit.findMany({
          where: { userId, isArchived: false },
          include: {
            completions: { where: { date: range }, orderBy: { date: "asc" } },
            skips: { where: { date: range } },
          },
        }),
        getUserTimezone(userId),
        getVacationWindow(userId),
      ])
      const today = localDateStr(tz)
      // Vacation freezes the streak on the Habits page; a rate that counted
      // those days as missed would contradict it.
      const isFrozen = makeIsFrozen(vacation)
      return ok(habits.map(h => {
        const done = h.completions.map(c => ymdOf(c.date))
        const doneSet = new Set(done)
        const skipped = new Set(h.skips.map(s => ymdOf(s.date)))
        const schedule = { scheduleDays: h.scheduleDays, timesPerWeek: h.timesPerWeek }
        const born = h.createdAt ? localDateStr(tz, h.createdAt) : null
        // It divided by 7 whatever the range: 24 of 30 days read "343%".
        let days = 0, due = 0, kept = 0
        for (let d = startDate; d <= endDate && d <= today; d = addDaysISO(d, 1)) {
          if (born && d < born) continue
          // Today counts once it is done; until then it is still in progress.
          if (d === today && !doneSet.has(d)) continue
          if (skipped.has(d) || isFrozen(d)) continue
          days++
          if (!isScheduledOn(schedule, d)) continue
          due++
          if (doneSet.has(d)) kept++
        }
        const expected = schedule.timesPerWeek != null ? Math.round(schedule.timesPerWeek * days / 7) : due
        const hits = schedule.timesPerWeek != null ? done.length : kept
        return {
          habit: h.name,
          completions: done,
          rate: expected > 0 ? `${Math.min(100, Math.round((hits / expected) * 100))}%` : null,
        }
      }))
    },
  )

  // ── JOURNAL / DAILY NOTES ─────────────────────────────────────────────────

  server.tool(
    "get_journal",
    "Read the journal/daily note for a specific date",
    { date: z.union([ymd, z.literal("today")]).describe("YYYY-MM-DD, or 'today'") },
    async ({ date }) => {
      const d = date === "today" ? await todayFor(userId) : date
      const note = await prisma.dailyNote.findUnique({
        where: { userId_date: { userId, date: dateColumn(d) } },
      })
      if (!note) return msg(`No journal entry for ${d}.`)
      return ok({ date: d, content: note.content })
    },
  )

  server.tool(
    "get_journal_entries",
    "Read all journal/daily notes in a date range (use get_journal for a single date)",
    dateRange,
    async ({ startDate, endDate }) => {
      const notes = await prisma.dailyNote.findMany({
        where: { userId, date: { gte: dateColumn(startDate), lte: dateColumnEnd(endDate) } },
        orderBy: { date: "asc" },
        select: { date: true, content: true },
      })
      if (!notes.length) return msg(`No journal entries between ${startDate} and ${endDate}.`)
      return ok(notes.map(n => ({ date: n.date.toISOString().slice(0, 10), content: n.content })))
    },
  )

  // The conversation with Emergy, read back. Everything said in the app's
  // chat, both sides, so the user (or the assistant they point at this
  // server) can look at how the chat is actually used — which questions
  // recur, how many messages are one-line logs, what he gets asked at night.
  // Read-only; the transcript is the user's own.
  server.tool(
    "get_chat_history",
    "Read the user's chat with Emergy (both sides) in a date range, oldest first. Each row: at (ISO), role (user|assistant), conversationId, content. Long stretches are paged by `limit` and `before` (an ISO time — pass the earliest `at` from the previous page).",
    {
      ...dateRange,
      limit: z.number().int().min(1).max(1000).optional().describe("Max rows, default 400"),
      before: z.string().optional().describe("Only rows before this ISO time — for paging back through a long range"),
    },
    async ({ startDate, endDate, limit, before }) => {
      const beforeAt = before ? new Date(before) : null
      const { window } = await localDays(userId, startDate, endDate)
      const rows = await prisma.chatMessage.findMany({
        where: {
          userId,
          createdAt: {
            gte: window.gte,
            lte: beforeAt && !Number.isNaN(beforeAt.getTime()) && beforeAt < window.lte ? beforeAt : window.lte,
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit ?? 400,
        select: { createdAt: true, role: true, conversationId: true, content: true },
      })
      if (!rows.length) return msg(`No chat messages between ${startDate} and ${endDate}.`)
      // Newest-first for the page, oldest-first for reading.
      return ok(rows.reverse().map(r => ({
        at: r.createdAt.toISOString(), role: r.role, conversationId: r.conversationId, content: r.content,
      })))
    },
  )

  server.tool(
    "write_journal",
    "Write or update the journal/daily note for today. Replaces the existing entry.",
    { content: z.string().describe("The journal entry text to save") },
    async ({ content }) => {
      const date = dateColumn(await todayFor(userId))
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
    "Get active (incomplete) reminders, soonest first, optionally followed by the most recently completed ones",
    { include_completed: z.boolean().optional().describe("Set true to also list the 20 most recently completed reminders") },
    async ({ include_completed }) => {
      // Two queries, not one over every row: a repeating reminder files a done
      // copy each time it is ticked, and two months of those, oldest due date
      // first, filled the whole page and pushed out every open reminder.
      const [open, done] = await Promise.all([
        prisma.reminder.findMany({
          where: { userId, isCompleted: false },
          orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
          take: 30,
        }),
        include_completed
          ? prisma.reminder.findMany({
              where: { userId, isCompleted: true },
              orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
              take: 20,
            })
          : Promise.resolve([]),
      ])
      return ok([...open, ...done].map(r => ({
        id: r.id,
        title: r.title,
        due: r.dueDate?.toISOString().slice(0, 10) ?? null,
        reminder_time: r.reminderTime ?? null,
        repeat: r.repeat ?? null,
        priority: r.priority,
        done: r.isCompleted,
        completed_at: r.completedAt?.toISOString() ?? null,
      })))
    },
  )

  server.tool(
    "create_reminder",
    "Create a new reminder or task",
    {
      title: z.string().describe("What to remember"),
      due_date: ymd.optional().describe("Optional due date in YYYY-MM-DD format"),
      reminder_time: z.string().optional().describe("Optional time for the notification, HH:MM (24h). With no due_date it rings at the next time that clock reading comes round"),
      priority: z.enum(["low", "normal", "high"]).optional().describe("Priority level, default is normal"),
    },
    async ({ title, due_date, reminder_time, priority }) => {
      // The phone rings only a row with a date, and reads an unparseable time
      // as 09:00 — so a time alone never rang and "6pm" rang at nine, while the
      // reply said "Reminder created". Same rule as Emergy's own tool.
      const tz = await getUserTimezone(userId)
      const when = resolveReminderWhen({
        time: reminder_time ?? null,
        dueDate: due_date ?? null,
        today: localDateStr(tz),
        nowMinutes: parseHhMm(localTimeStr(tz)) ?? 0,
      })
      if (reminder_time && !when.reminderTime) {
        return msg(`Couldn't read "${reminder_time}" as a time — nothing was saved. Use HH:MM (24h), like 18:30.`)
      }
      const reminder = await prisma.reminder.create({
        data: {
          userId,
          title,
          dueDate: when.dueDate ? dateColumn(when.dueDate) : null,
          reminderTime: when.reminderTime,
          priority: priority ?? "normal",
          tags: [],
        },
      })
      return msg(`Reminder set: "${reminder.title}" (${when.label}).`)
    },
  )

  server.tool(
    "complete_reminder",
    "Mark a reminder as done by matching its title",
    { title: z.string().describe("Title of the reminder to complete (partial match)") },
    async ({ title }) => {
      const reminder = await prisma.reminder.findFirst({
        where: { userId, isCompleted: false, title: { contains: title, mode: "insensitive" } },
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      })
      if (!reminder) return msg(`No active reminder matching "${title}".`)
      // Through lib/reminders: flipping isCompleted here ended a repeating
      // series outright, and the phone never rang it again.
      const result = await completeReminder(userId, reminder.id)
      if (!result.ok) return msg(`Couldn't mark "${reminder.title}" as done — nothing was changed.`)
      return msg(result.rolledTo
        ? `✓ Marked "${reminder.title}" as done. It repeats — the next one is ${result.rolledTo}.`
        : `✓ Marked "${reminder.title}" as done.`)
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
      const today = await todayFor(userId)
      const date = dateColumn(today)
      await prisma.moodLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, mood, note: note ?? null },
        update: { mood, note: note ?? null },
      })
      const labels = ["", "Awful", "Bad", "Okay", "Good", "Great"]
      // The morning check-in wins its day (lib/mood-series): a different mood
      // logged after it is stored and read nowhere, and has to be said so.
      const effective = (await loadMoodByDay(userId, today, today).catch(() => null))?.get(today)
      if (effective != null && effective !== mood) {
        return msg(`Noted mood ${mood}/5${note ? ` (${note})` : ""}, but today's morning check-in said ${effective}/5 and the check-in stays the day's mood everywhere in the app.`)
      }
      return msg(`Mood logged: ${mood}/5 — ${labels[mood]}${note ? ` (${note})` : ""}`)
    },
  )

  server.tool(
    "get_mood_history",
    "Get the user's mood for a date range, one score per day (1-5) with a label, from both the standalone mood log (with its note) and the morning check-in — the check-in's answer wins a day both have",
    dateRange,
    async ({ startDate, endDate }) => {
      // Mood lives in two tables. This read MoodLog alone, so a month of
      // check-in answers came back as "no mood logged".
      const [byDay, logs] = await Promise.all([
        loadMoodByDay(userId, startDate, endDate),
        prisma.moodLog.findMany({
          where: { userId, date: { gte: dateColumn(startDate), lte: dateColumnEnd(endDate) } },
          select: { date: true, mood: true, note: true },
        }).catch(() => []),
      ])
      const notes = new Map(logs.map(l => [moodDay(l.date), { mood: l.mood, note: l.note }]))
      const labels = ["", "Awful", "Bad", "Okay", "Good", "Great"]
      return ok([...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, score]) => {
        const standalone = notes.get(date)
        return {
          date,
          score,
          label: labels[score],
          source: standalone && standalone.mood === score ? "mood_log" : "morning_checkin",
          note: standalone?.note ?? null,
        }
      }))
    },
  )

  // ── INTAKE ────────────────────────────────────────────────────────────────

  server.tool(
    "log_intake",
    "Log water, coffee, tea, or alcohol intake",
    {
      type: z.enum(["water", "sparkling", "coffee", "tea", "matcha", "beer", "wine", "spirits", "alcohol", "other"]).describe("Type of drink"),
      amount_ml: z.number().int().min(1).max(5000).describe("Amount in millilitres, e.g. 250 for a glass, 500 for a bottle"),
      note: z.string().optional().describe("Optional note, e.g. the drink style (cold brew, 12°)"),
    },
    async ({ type, amount_ml, note }) => {
      const written = await recordDrink({ userId, type, amountMl: amount_ml, note: note ?? null })
      if (!written) return msg("Couldn't save that drink — nothing was written.")
      // Said out loud rather than logged and forgotten: the drink is on record
      // and its dose is not, so body load and the caffeine cutoff are short.
      const short = written.caffeineMirrorFailed
        ? " The caffeine didn't record, so it won't show in body load."
        : ""
      return msg(`Logged ${amount_ml}ml of ${type}.${short}`)
    },
  )

  server.tool(
    "get_intake_today",
    "Get all intake logs for today (water, coffee, etc.), with local clock times. hydration_ml counts every hydrating drink at its factor — the figure the app shows",
    {},
    async () => {
      const { timezone, start, end } = await userDay(userId)
      const logs = await prisma.intakeLog.findMany({
        where: { userId, loggedAt: { gte: start, lte: end } },
        orderBy: { loggedAt: "asc" },
      })
      const totals: Record<string, number> = {}
      for (const l of logs) totals[l.type] = (totals[l.type] ?? 0) + l.amountMl
      // Glasses counted rows typed "water" alone, so sparkling and tea were
      // nothing here while the briefing and the app counted them.
      const hydrationMl = sumHydration(logs)
      return ok({
        entries: logs.map(l => ({ type: l.type, amount_ml: l.amountMl, note: l.note, time: localTimeStr(timezone, l.loggedAt) })),
        totals_ml: totals,
        hydration_ml: hydrationMl,
        water_glasses: Math.round(hydrationMl / 250 * 10) / 10,
      })
    },
  )

  server.tool(
    "get_food_log",
    "Get photo-analyzed meals and drinks from the Food tab for a day: per-meal calories/macros, each recognized item with its portion and whether its nutrition came from the USDA database (db) or was model-estimated (est), plus notable vitamins/minerals",
    { date: ymd.optional().describe("Day as YYYY-MM-DD, defaults to today") },
    async ({ date }) => {
      const day = date ?? await todayFor(userId)
      const { tz, window } = await localDays(userId, day)
      const [logs, dayDrinks] = await Promise.all([
        prisma.foodLog.findMany({
          where: { userId, loggedAt: window },
          orderBy: { loggedAt: "asc" },
          select: {
            name: true, mealType: true, calories: true, proteinG: true, carbsG: true,
            fatG: true, sugarG: true, items: true, micros: true, note: true,
            place: true, loggedAt: true,
          },
        }),
        prisma.intakeLog.findMany({
          where: { userId, loggedAt: window },
          select: { id: true, type: true, amountMl: true, note: true },
        }).catch(() => [] as { id: string; type: string; amountMl: number; note: string | null }[]),
      ])
      // Drinks carry calories too — meals alone made a wine evening read as
      // fasting. Kept as its own number so the meal list stays the meal list.
      const drinkKcal = drinkCaloriesTotal(dayDrinks)
      const mealKcal = logs.reduce((s, l) => s + l.calories, 0)
      return ok({
        date: day,
        meals: logs.map(l => ({
          time: localTimeStr(tz, l.loggedAt),
          name: l.name,
          meal_type: l.mealType,
          calories: l.calories,
          protein_g: l.proteinG, carbs_g: l.carbsG, fat_g: l.fatG, sugar_g: l.sugarG,
          items: l.items,
          micros: l.micros,
          note: l.note,
          place: l.place,
        })),
        meal_calories: mealKcal,
        drink_calories: drinkKcal,
        total_calories: mealKcal + drinkKcal,
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
      duration_min: z.number().int().min(1).max(600).describe("Duration of the session in minutes"),
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
      const { tz: focusTz, window } = await localDays(userId, startDate, endDate)
      const sessions = await prisma.focusSession.findMany({
        where: { userId, endedAt: window },
        orderBy: { endedAt: "desc" },
      })
      const totalMin = sessions.reduce((s, f) => s + f.durationMin, 0)
      const focusDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: focusTz })
      const focusTimeFmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: focusTz, hour: "2-digit", minute: "2-digit", hour12: false,
      })
      return ok({
        total_focused: `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`,
        // Both were sliced out of the ISO string, which is UTC — so a session
        // was reported on the wrong day and at the wrong clock time, and
        // Emergy repeated both back as fact.
        sessions: sessions.map(f => ({
          label: f.label,
          duration_min: f.durationMin,
          date: focusDayFmt.format(f.endedAt),
          time: focusTimeFmt.format(f.endedAt),
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
        getTodayEntries(stored.apiToken, await getUserTimezone(userId)),
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

  // ── LOCATION CORRELATIONS ─────────────────────────────────────────────────

  server.tool(
    "get_location_correlations",
    "Get health metric correlations for saved places — how health metrics differ after visiting each place vs otherwise. Readiness, sleep, HRV and resting HR are the NIGHT AFTER a visit day (vs other nights); steps and mood are the visit day itself (vs other days). Results include a confidence label based on visit count.",
    {},
    async () => {
      type SavedPlaceRow = { id: string; name: string; emoji: string }
      type CheckInRow = { checkedAt: Date }

      const savedPlaces = await prisma.$queryRaw<SavedPlaceRow[]>`
        SELECT id, name, emoji FROM "SavedPlace" WHERE "userId" = ${userId}
      `.catch(() => [] as SavedPlaceRow[])

      if (!savedPlaces.length) return msg("No saved places found. Add places in the Location page to track health correlations.")

      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      const corrDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: await getUserTimezone(userId) })

      const [healthLogs, moodByDay, anyCheckIns] = await Promise.all([
        prisma.healthLog.findMany({
          where: { userId, date: { gte: since } },
          select: { date: true, readinessScore: true, sleepDuration: true, hrv: true, steps: true, restingHR: true },
        }),
        // Both mood tables, merged in lib/mood-series.
        loadMoodByDay(userId, moodDay(since), "9999-12-31"),
        // A day with no check-in of any kind had no tracking, not a day away:
        // it belongs on neither side, the engine's rule for places.
        prisma.$queryRaw<CheckInRow[]>`
          SELECT "checkedAt" FROM "CheckIn"
          WHERE "userId" = ${userId} AND "checkedAt" >= ${since}
        `.catch(() => [] as CheckInRow[]),
      ])
      const covered = new Set(anyCheckIns.map(c => corrDayFmt.format(new Date(c.checkedAt))))
      const moodLogs = [...moodByDay.entries()].map(([day, mood]) => ({ day, mood }))

      function avgNums(nums: (number | null)[]): number | null {
        const valid = nums.filter((n): n is number => n != null)
        return valid.length ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10 : null
      }

      function confLabel(n: number) {
        if (n < 6)  return "insufficient (< 6 visits)"
        if (n < 15) return "low (6–14 visits)"
        if (n < 30) return "moderate (15–29 visits)"
        return "good (30+ visits)"
      }

      const results = await Promise.all(savedPlaces.map(async place => {
        const checkIns = await prisma.$queryRaw<CheckInRow[]>`
          SELECT "checkedAt" FROM "CheckIn"
          WHERE "userId" = ${userId} AND "savedPlaceId" = ${place.id}
            AND "isAuto" = true AND "checkedAt" >= ${since}
        `.catch(() => [] as CheckInRow[])

        // checkedAt is an instant: slicing it in UTC files an evening visit
        // under the previous day, against health rows keyed by the local one.
        const visitDates = new Set(checkIns.map(c => corrDayFmt.format(new Date(c.checkedAt))))
        // A HealthLog row's night ends on the morning of its date, so the
        // visit day's own row is the night BEFORE the visit. Night metrics are
        // read from the next day's row, as the in-app Insights panel does;
        // reading the visit day compared the wrong nights and put the
        // post-visit ones in the baseline, reversing the sign.
        const nightAfter = new Set([...visitDates].map(d => addDaysISO(d, 1)))
        const visitH    = healthLogs.filter(h =>  visitDates.has(ymdOf(h.date)))
        const nonVisitH = healthLogs.filter(h => covered.has(ymdOf(h.date)) && !visitDates.has(ymdOf(h.date)))
        const nightH    = healthLogs.filter(h =>  nightAfter.has(ymdOf(h.date)))
        // A night belongs to the day before it, so it is only "not after a
        // visit" when that day had location data at all.
        const nonNightH = healthLogs.filter(h => covered.has(addDaysISO(ymdOf(h.date), -1)) && !nightAfter.has(ymdOf(h.date)))
        const visitM    = moodLogs.filter(m =>  visitDates.has(m.day))
        const nonVisitM = moodLogs.filter(m => covered.has(m.day) && !visitDates.has(m.day))

        const v = {
          readiness: avgNums(nightH.map(h => h.readinessScore)),
          sleep_h: avgNums(nightH.map(h => h.sleepDuration != null ? h.sleepDuration / 60 : null)),
          hrv: avgNums(nightH.map(h => h.hrv)),
          steps: avgNums(visitH.map(h => h.steps)),
          resting_hr: avgNums(nightH.map(h => h.restingHR)),
          mood: avgNums(visitM.map(m => m.mood)),
        }
        const nv = {
          readiness: avgNums(nonNightH.map(h => h.readinessScore)),
          sleep_h: avgNums(nonNightH.map(h => h.sleepDuration != null ? h.sleepDuration / 60 : null)),
          hrv: avgNums(nonNightH.map(h => h.hrv)),
          steps: avgNums(nonVisitH.map(h => h.steps)),
          resting_hr: avgNums(nonNightH.map(h => h.restingHR)),
          mood: avgNums(nonVisitM.map(m => m.mood)),
        }

        const delta = (key: keyof typeof v) =>
          v[key] != null && nv[key] != null
            ? Math.round(((v[key] as number) - (nv[key] as number)) * 10) / 10
            : null

        return {
          place: `${place.emoji} ${place.name}`,
          visits_last_90d: checkIns.length,
          confidence: confLabel(checkIns.length),
          deltas: {
            readiness_pts: delta("readiness"),
            sleep_hours: delta("sleep_h"),
            hrv_ms: delta("hrv"),
            steps: delta("steps"),
            resting_hr_bpm: delta("resting_hr"),
            mood_out_of_5: delta("mood"),
          },
          note: checkIns.length < 6 ? "Too few visits — data not reliable yet" : undefined,
        }
      }))

      results.sort((a, b) => b.visits_last_90d - a.visits_last_90d)
      return ok({ places: results, disclaimer: "Correlation ≠ causation. Over the last 90 days: readiness, sleep, HRV and resting HR compare the night after a visit with other nights; steps and mood compare visit days with other days. Days with no location data are excluded from both sides rather than counted as days elsewhere." })
    },
  )

  server.tool(
    "get_trips",
    "Where the user has been at the coarse, day-by-day level: which days were spent at home, which away, the trips away from home (with dates, nights and distance), and how sleep, readiness, HRV and mood compare on away nights/days versus home ones. Use this for questions about travel, being away, or whether a trip affected how they slept or felt. Home is inferred from where nights are spent — no saved place needed, and it works retroactively over history.",
    { days: z.number().optional().describe("How far back to look, in days. Default 180.") },
    async ({ days }) => {
      const window = Math.min(Math.max(days ?? 180, 7), 730)
      const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000)

      const [timezone, loaded, healthLogs, moodByDay] = await Promise.all([
        getUserTimezone(userId),
        loadCoarsePoints(userId, since),
        prisma.healthLog.findMany({
          where: { userId, date: { gte: since } },
          select: { date: true, readinessScore: true, sleepDuration: true, hrv: true },
        }).catch(() => []),
        // Both mood tables, merged in lib/mood-series.
        loadMoodByDay(userId, moodDay(since), "9999-12-31"),
      ])

      const dated = loaded.points
      const home = estimateHome(dated, timezone)
      if (!home) return msg("No location history yet, so there is nothing to say about home or away. Background location tracking has to run through a few nights first.")

      const dayRows = summariseDays(dated, timezone, home)
      const iso = (d: Date) => d.toISOString().slice(0, 10)
      const metrics = new Map<string, DayMetrics>()
      for (const h of healthLogs) {
        metrics.set(iso(h.date), {
          sleepHours: h.sleepDuration == null ? null : h.sleepDuration / 60,
          readiness: h.readinessScore,
          hrv: h.hrv,
          mood: null,
        })
      }
      for (const [day, mood] of moodByDay) {
        const row = metrics.get(day)
        if (row) row.mood = mood
        else metrics.set(day, { sleepHours: null, readiness: null, hrv: null, mood })
      }

      const round = (n: number | null, d = 1) => n == null ? null : Math.round(n * 10 ** d) / 10 ** d
      const sideOut = (s: { n: number; sleepHours: number | null; readiness: number | null; hrv: number | null; mood: number | null }) => ({
        n: s.n, sleep_hours: round(s.sleepHours), readiness: round(s.readiness, 0), hrv_ms: round(s.hrv, 0), mood_out_of_5: round(s.mood),
      })
      const c = awayVsHome(dayRows, metrics)

      return ok({
        window_days: window,
        days_with_location_data: dayRows.length,
        points_by_source: loaded.countsBySource,
        home: { lat: round(home.lat, 4), lng: round(home.lng, 4), nights_seen: home.nights },
        day_counts: {
          home_all_day: dayRows.filter(d => d.presence === "home").length,
          out_locally: dayRows.filter(d => d.presence === "local").length,
          away: dayRows.filter(d => d.presence === "away").length,
        },
        trips: detectTrips(dayRows).map(t => ({
          start: t.start, end: t.end, nights: t.nights,
          max_km_from_home: Math.round(t.maxKmFromHome),
          lat: round(t.lat, 3), lng: round(t.lng, 3),
          days_unrecorded: t.gapDays,
        })),
        away_nights_vs_home_nights: { away: sideOut(c.nights.away), home: sideOut(c.nights.home) },
        away_days_vs_home_days: { away: sideOut(c.days.away), home: sideOut(c.days.home) },
        notes: "Days with no location fixes are excluded from both sides rather than counted as home. Trips are named only by coordinates here — reverse-geocode or ask the user for the place name. Correlation is not causation, and a handful of trips is not a sample.",
      })
    },
  )

  // ── DAILY BRIEFING ────────────────────────────────────────────────────────

  server.tool(
    "get_daily_briefing",
    "Get a full personal briefing for today or a specific date: health, habits, reminders, intake, focus, and mood all in one call. Use this when the user asks 'how am I doing today?' or wants a summary.",
    { date: ymd.optional().describe("YYYY-MM-DD, defaults to today") },
    async ({ date }) => {
      const d = date ?? await todayFor(userId)
      const todayStart = dateColumn(d)
      const { tz, window } = await localDays(userId, d)

      const [healthLog, habits, reminders, intakeLogs, focusSessions, moodLog, checkin, ouraTags, journalNote] = await Promise.all([
        prisma.healthLog.findUnique({ where: { userId_date: { userId, date: todayStart } } }),
        prisma.habit.findMany({
          where: { userId, isArchived: false },
          // From the week's Monday, so an N-times-a-week habit can be judged.
          include: {
            completions: { where: { date: { gte: dateColumn(weekStart(d)), lte: todayStart } }, select: { date: true } },
            skips: { where: { date: todayStart }, select: { date: true } },
          },
        }),
        prisma.reminder.findMany({
          where: { userId, isCompleted: false, dueDate: { lte: new Date(d + "T23:59:59Z") } },
          orderBy: { dueDate: "asc" },
          take: 5,
        }),
        prisma.intakeLog.findMany({ where: { userId, loggedAt: window } }),
        prisma.focusSession.findMany({ where: { userId, endedAt: window } }),
        prisma.moodLog.findUnique({ where: { userId_date: { userId, date: todayStart } } }),
        prisma.morningCheckIn.findUnique({
          where: { userId_date: { userId, date: d } },
          select: { energy: true, mood: true, intention: true },
        }).catch(() => null),
        prisma.ouraTag.findMany({
          where: { userId, day: d },
          orderBy: { timestamp: "asc" },
          select: { timestamp: true, tagName: true, text: true },
        }).catch(() => []),
        prisma.dailyNote.findUnique({
          where: { userId_date: { userId, date: todayStart } },
          select: { content: true },
        }).catch(() => null),
      ])

      // Hydration is every drink at its factor (lib/hydration), not the rows typed "water".
      const waterMl = sumHydration(intakeLogs)
      const coffeeCups = intakeLogs.filter(l => l.type === "coffee").length
      const focusMin = focusSessions.reduce((s, f) => s + f.durationMin, 0)
      // Only the habits the schedule asked for that day, as /api/today counts
      // them: a Mon/Wed/Fri habit on a Tuesday is not a habit left undone.
      const habitList = habits.flatMap(h => {
        const done = new Set(h.completions.map(c => ymdOf(c.date)))
        const schedule = { scheduleDays: h.scheduleDays, timesPerWeek: h.timesPerWeek }
        return isDueOn(schedule, d, done) || done.has(d)
          ? [{ name: h.name, done: done.has(d), skipped: !done.has(d) && h.skips.length > 0 }]
          : []
      })
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
        morning_checkin: checkin ? { energy: checkin.energy, mood: checkin.mood, intention: checkin.intention } : null,
        oura_tags: ouraTags
          .map(tag => ({ time: localTimeStr(tz, tag.timestamp), tag: (tag.tagName ?? tag.text ?? "").trim() }))
          .filter(t => t.tag),
        journal: journalNote?.content ?? null,
        // A skip is neither done nor missed; the app's tile counts it toward
        // done/due, so it is reported rather than left to read as undone.
        habits: { completed: habitList.filter(h => h.done).length, skipped: habitList.filter(h => h.skipped).length, total: habitList.length, list: habitList },
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
