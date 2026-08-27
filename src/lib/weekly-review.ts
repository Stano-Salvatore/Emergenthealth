import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { format } from "date-fns"
import { buildSystemPrompt } from "@/lib/claude"
import { addDaysISO, localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"

// The weekly review used to be three different things: a Sunday email with
// bare averages, a dashboard button that asked Haiku for 200 generic words,
// and nothing from Emergy at all. This is the one generator all surfaces
// share now, and it runs on Emergy's full brain — the same system prompt as
// chat, so the review knows the user's goals, their correlation patterns,
// their wearable gaps and the honesty rules about all three.

export const WEEKLY_REVIEW_KEY = "emergy_weekly_review"

export type WeeklyReviewStats = {
  daysTracked: number
  avgSleepH: number | null
  prevAvgSleepH: number | null
  avgHrv: number | null
  prevAvgHrv: number | null
  avgReadiness: number | null
  totalSteps: number
  habitRate: number | null
  totalFocusMin: number
  workouts: number
}

export type WeeklyReview = {
  weekOf: string // "August 11" — the Monday of the reviewed week
  generatedAt: string
  narrative: string
  stats: WeeklyReviewStats
}

function avg(arr: (number | null | undefined)[]): number | null {
  const vals = arr.filter((v): v is number => v != null)
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null
}

/**
 * Build the week's numbers and have Emergy write the review. Returns null
 * when generation isn't possible (no API key) or there is nothing to review
 * (no health data or check-ins all week).
 */
export async function generateWeeklyReview(userId: string, timezone?: string): Promise<WeeklyReview | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null

  // The week is the USER'S week. The cron fires on their local Sunday
  // evening, which for anyone west of UTC is already Monday in server time —
  // computing the week from new Date() there would review the hour-old new
  // week (empty) instead of the one that just ended.
  const tz = timezone ?? await getUserTimezone(userId)
  const todayStr = localDateStr(tz)
  const dow = new Date(todayStr + "T12:00:00Z").getUTCDay() // 0 = Sunday
  const weekStartStr = addDaysISO(todayStr, -((dow + 6) % 7)) // Monday of their week
  const prevWeekStartStr = addDaysISO(weekStartStr, -7)
  // healthLog.date sits at UTC midnight of the calendar day, so these
  // boundaries select whole local calendar days.
  const weekStart = new Date(weekStartStr + "T00:00:00Z")
  const today = new Date(todayStr + "T23:59:59Z")
  const prevWeekStart = new Date(prevWeekStartStr + "T00:00:00Z")
  const prevWeekEnd = new Date(addDaysISO(weekStartStr, -1) + "T23:59:59Z")

  const [thisWeekLogs, prevWeekLogs, habits, focusSessions, moodLogs, waterLogs, checkinRows, stravaRows] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: weekStart, lte: today } },
      orderBy: { date: "asc" },
      select: { date: true, sleepDuration: true, steps: true, hrv: true, readinessScore: true, activityScore: true, stressHigh: true },
    }),
    prisma.healthLog.findMany({
      where: { userId, date: { gte: prevWeekStart, lte: prevWeekEnd } },
      select: { sleepDuration: true, steps: true, hrv: true, readinessScore: true },
    }),
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      include: { completions: { where: { date: { gte: weekStart, lte: today } } } },
    }),
    prisma.focusSession.findMany({
      where: { userId, type: "focus", endedAt: { gte: weekStart, lte: today } },
      select: { durationMin: true },
    }).catch(() => [] as { durationMin: number }[]),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: weekStart, lte: today } },
      select: { mood: true },
    }).catch(() => [] as { mood: number }[]),
    prisma.intakeLog.findMany({
      where: { userId, type: "water", loggedAt: { gte: weekStart, lte: today } },
      select: { amountMl: true },
    }).catch(() => [] as { amountMl: number }[]),
    prisma.$queryRaw<{ date: string; energy: number; mood: number; intention: string | null }[]>`
      SELECT "date", "energy", "mood", "intention" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" >= ${weekStartStr} AND "date" <= ${todayStr}
      ORDER BY "date" ASC
    `.catch(() => [] as { date: string; energy: number; mood: number; intention: string | null }[]),
    prisma.stravaActivity.findMany({
      where: { userId, day: { gte: weekStartStr } },
      select: { name: true, type: true, distanceM: true, movingTimeSec: true },
    }).catch(() => [] as { name: string | null; type: string; distanceM: number | null; movingTimeSec: number }[]),
  ])

  // Nothing tracked all week — a review would be fiction.
  if (thisWeekLogs.length === 0 && checkinRows.length === 0) return null

  const daysThisWeek = ((dow + 6) % 7) + 1
  const trackedDays = new Set(thisWeekLogs.map(l => l.date.toISOString().slice(0, 10))).size

  const avgSleepMin = avg(thisWeekLogs.map(l => l.sleepDuration))
  const avgSleepH = avgSleepMin != null ? Math.round((avgSleepMin / 60) * 10) / 10 : null
  const prevAvgSleepMin = avg(prevWeekLogs.map(l => l.sleepDuration))
  const prevAvgSleepH = prevAvgSleepMin != null ? Math.round((prevAvgSleepMin / 60) * 10) / 10 : null
  const avgHrv = avg(thisWeekLogs.map(l => l.hrv))
  const prevAvgHrv = avg(prevWeekLogs.map(l => l.hrv))
  const avgReadiness = avg(thisWeekLogs.map(l => l.readinessScore))
  const prevAvgReadiness = avg(prevWeekLogs.map(l => l.readinessScore))
  const totalSteps = thisWeekLogs.reduce((s, l) => s + (l.steps ?? 0), 0)
  const prevTotalSteps = prevWeekLogs.reduce((s, l) => s + (l.steps ?? 0), 0)
  const avgStress = avg(thisWeekLogs.map(l => l.stressHigh))

  const habitRows = habits.map(h => ({
    name: h.name,
    completed: h.completions.length,
    pct: Math.round((h.completions.length / daysThisWeek) * 100),
  }))
  const habitRate = habitRows.length > 0
    ? Math.round(habitRows.reduce((s, h) => s + h.pct, 0) / habitRows.length)
    : null

  const totalFocusMin = focusSessions.reduce((s, f) => s + f.durationMin, 0)
  const avgMood = avg(moodLogs.map(m => m.mood))
  const totalWaterL = (waterLogs.reduce((s, i) => s + i.amountMl, 0) / 1000).toFixed(1)
  const avgCheckinEnergy = avg(checkinRows.map(c => c.energy))
  const intentions = checkinRows.map(c => c.intention).filter((s): s is string => !!s?.trim())
  const workoutKm = stravaRows.reduce((s, w) => s + (w.distanceM ?? 0) / 1000, 0)

  const weekOf = format(new Date(weekStartStr + "T12:00:00Z"), "MMMM d")

  const lines: string[] = [
    `Days with wearable data: ${trackedDays}/${daysThisWeek}${trackedDays < daysThisWeek ? " (the rest are gaps, not zeros)" : ""}`,
    `Sleep: avg ${avgSleepH ?? "no data"}h/night${prevAvgSleepH != null ? ` (last week ${prevAvgSleepH}h)` : ""}`,
    `HRV: avg ${avgHrv ?? "no data"}ms${prevAvgHrv != null ? ` (last week ${prevAvgHrv}ms)` : ""}`,
    `Readiness: avg ${avgReadiness ?? "no data"}${prevAvgReadiness != null ? ` (last week ${prevAvgReadiness})` : ""}`,
    `Steps: ${totalSteps.toLocaleString()} total${prevTotalSteps > 0 ? ` (last week ${prevTotalSteps.toLocaleString()})` : ""}`,
    avgStress != null ? `Daytime stress: avg ${avgStress}min elevated/day` : null,
    `Deep work: ${totalFocusMin}min across ${focusSessions.length} sessions`,
    stravaRows.length > 0 ? `Workouts: ${stravaRows.length}${workoutKm > 0 ? `, ${workoutKm.toFixed(1)}km` : ""}` : null,
    `Water: ${totalWaterL}L logged`,
    avgMood != null ? `Mood: avg ${avgMood}/5` : null,
    `Morning check-ins: ${checkinRows.length}/${daysThisWeek}${avgCheckinEnergy != null ? `, avg energy ${avgCheckinEnergy}/5` : ""}`,
    habitRows.length > 0 ? `Habits:\n${habitRows.map(h => `  - ${h.name}: ${h.completed}/${daysThisWeek} days`).join("\n")}` : null,
    intentions.length > 0 ? `Intentions they set this week: ${intentions.slice(0, 7).join(" · ")}` : null,
  ].filter((l): l is string => l != null)

  const instruction = `It's Sunday evening — write my weekly review for the week of ${weekOf}.

THIS WEEK'S NUMBERS (already aggregated; last week in parentheses where it exists):
${lines.join("\n")}

Write it as 3–4 short paragraphs of plain prose — no headers, no bullet lists.
- Open with the single most true thing about this week.
- Compare against last week only where the numbers actually moved.
- If one of the patterns from my data fits what happened this week, bring it up — hedged to the evidence, per your rules.
- If days are missing (wearable off, nothing logged), say so plainly instead of smoothing over it.
- End with one small, concrete suggestion for next week drawn from this week's data — not generic advice.
Keep it under 250 words.`

  const { prompt: systemPrompt } = await buildSystemPrompt(userId)
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 700,
    system: systemPrompt,
    messages: [{ role: "user", content: instruction }],
  })

  const narrative = response.content
    .map(c => (c.type === "text" ? c.text : ""))
    .join("")
    .trim()
  if (!narrative) return null

  return {
    weekOf,
    generatedAt: new Date().toISOString(),
    narrative,
    stats: {
      daysTracked: trackedDays,
      avgSleepH,
      prevAvgSleepH,
      avgHrv,
      prevAvgHrv,
      avgReadiness,
      totalSteps,
      habitRate,
      totalFocusMin,
      workouts: stravaRows.length,
    },
  }
}

export async function saveWeeklyReview(userId: string, review: WeeklyReview): Promise<void> {
  const value = JSON.stringify(review)
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: WEEKLY_REVIEW_KEY } },
    create: { userId, key: WEEKLY_REVIEW_KEY, value },
    update: { value },
  }).catch(() => {})
}

export async function readWeeklyReview(userId: string): Promise<WeeklyReview | null> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: WEEKLY_REVIEW_KEY } },
    select: { value: true },
  }).catch(() => null)
  if (!row) return null
  try {
    const parsed = JSON.parse(row.value) as WeeklyReview
    return parsed.narrative ? parsed : null
  } catch {
    return null
  }
}
