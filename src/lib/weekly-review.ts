import { prisma } from "@/lib/prisma"
import { loadMoodSeries } from "@/lib/mood-series"
import Anthropic from "@anthropic-ai/sdk"
import { format } from "date-fns"
import { buildSystemPrompt } from "@/lib/claude"
import { addDaysISO, localDateStr, zonedDayRange } from "@/lib/local-date"
import { HYDRATING_TYPES, sumHydration } from "@/lib/hydration"
import { getUserTimezone } from "@/lib/user-timezone"
import { SONNET } from "@/lib/models"
import { recordModelTurn } from "@/lib/model-spend"
import { phoneNights, hoursLabel } from "@/lib/phone-sleep"
import { weekTally } from "@/lib/habit-schedule"
import { getVacationWindow, makeIsFrozen } from "@/lib/streak"

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

const steps = (n: number) => Math.round(n).toLocaleString("en-US")

/**
 * Steps as a daily average over the days that have a count. A total summed
 * untracked days in as zeros: four tracked days at 10k read "40,000 (last
 * week 63,000)" and the review said he moved a third less while his daily
 * average went up.
 */
export function stepsLine(thisWeek: (number | null)[], prevWeek: (number | null)[]): string {
  const now = thisWeek.filter((v): v is number => v != null)
  const prev = prevWeek.filter((v): v is number => v != null)
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
  if (now.length === 0) return "Steps: no data"
  const last = prev.length > 0 ? ` (last week ${steps(mean(prev))}/day over ${prev.length} days)` : ""
  return `Steps: avg ${steps(mean(now))}/day over ${now.length} tracked days${last}`
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
  // Timestamp columns are different: the week runs from the user's own
  // Monday midnight, not UTC's, or a Sunday-night drink lands in next week.
  const weekStartAt = zonedDayRange(tz, weekStartStr).start
  const weekEndAt = zonedDayRange(tz, todayStr).end

  const [thisWeekLogs, prevWeekLogs, habits, focusSessions, moodLogs, waterLogs, checkinRows, stravaRows, vacation] = await Promise.all([
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
      include: {
        completions: { where: { date: { gte: weekStart, lte: today } }, select: { date: true } },
        skips: { where: { date: { gte: weekStart, lte: today } }, select: { date: true } },
      },
    }),
    prisma.focusSession.findMany({
      where: { userId, type: "focus", endedAt: { gte: weekStartAt, lte: weekEndAt } },
      select: { durationMin: true },
    }).catch(() => [] as { durationMin: number }[]),
    // Both tables, check-in first — see lib/mood-series.
    loadMoodSeries(userId, weekStartStr, todayStr).catch(() => [] as { day: string; mood: number }[]),
    // Every hydrating drink: a week of tea and sparkling water read "Water:
    // 0.3L logged" when the rows were filtered on type "water".
    prisma.intakeLog.findMany({
      where: { userId, type: { in: HYDRATING_TYPES }, loggedAt: { gte: weekStartAt, lte: weekEndAt } },
      select: { amountMl: true, type: true },
    }).catch(() => [] as { amountMl: number; type: string }[]),
    prisma.$queryRaw<{ date: string; energy: number; mood: number; intention: string | null }[]>`
      SELECT "date", "energy", "mood", "intention" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" >= ${weekStartStr} AND "date" <= ${todayStr}
      ORDER BY "date" ASC
    `.catch(() => [] as { date: string; energy: number; mood: number; intention: string | null }[]),
    prisma.stravaActivity.findMany({
      where: { userId, day: { gte: weekStartStr } },
      select: { name: true, type: true, distanceM: true, movingTimeSec: true },
    }).catch(() => [] as { name: string | null; type: string; distanceM: number | null; movingTimeSec: number }[]),
    getVacationWindow(userId),
  ])

  // The nights the ring missed but the phone estimated. Their own line and
  // their own count: a motion guess averaged in with ring nights would move
  // "avg sleep" with a number that is not a measurement.
  const ringNightDays = new Set(thisWeekLogs.filter(l => l.sleepDuration != null).map(l => l.date.toISOString().slice(0, 10)))
  const phoneOnly = (await phoneNights(userId, weekStartAt, new Date(), tz)).filter(n => !ringNightDays.has(n.day))

  // Nothing tracked all week — a review would be fiction.
  if (thisWeekLogs.length === 0 && checkinRows.length === 0 && phoneOnly.length === 0) return null

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
  const avgStress = avg(thisWeekLogs.map(l => l.stressHigh))

  // Against what each schedule asked, not seven: a Mon/Wed/Fri habit kept
  // perfectly went to Emergy as "Gym: 3/7 days", and he called it a slip.
  const isFrozen = makeIsFrozen(vacation)
  const habitRows = habits.map(h => {
    const { done, due } = weekTally(
      { scheduleDays: h.scheduleDays, timesPerWeek: h.timesPerWeek },
      new Set(h.completions.map(c => c.date.toISOString().slice(0, 10))),
      new Set(h.skips.map(s => s.date.toISOString().slice(0, 10))),
      weekStartStr, todayStr, localDateStr(tz, h.createdAt), isFrozen,
    )
    return {
      name: h.name, done, due, target: h.timesPerWeek,
      pct: due > 0 ? Math.round((done / due) * 100) : null,
    }
  })
  const asked = habitRows.filter((h): h is typeof h & { pct: number } => h.pct != null)
  const habitRate = asked.length > 0
    ? Math.round(asked.reduce((s, h) => s + h.pct, 0) / asked.length)
    : null

  const totalFocusMin = focusSessions.reduce((s, f) => s + f.durationMin, 0)
  const avgMood = avg(moodLogs.map(m => m.mood))
  const totalFluidL = (sumHydration(waterLogs) / 1000).toFixed(1)
  const avgCheckinEnergy = avg(checkinRows.map(c => c.energy))
  const intentions = checkinRows.map(c => c.intention).filter((s): s is string => !!s?.trim())
  const workoutKm = stravaRows.reduce((s, w) => s + (w.distanceM ?? 0) / 1000, 0)

  const weekOf = format(new Date(weekStartStr + "T12:00:00Z"), "MMMM d")

  const lines: string[] = [
    `Days with wearable data: ${trackedDays}/${daysThisWeek}${trackedDays < daysThisWeek ? " (the rest are gaps, not zeros)" : ""}`,
    `Sleep (ring): avg ${avgSleepH ?? "no data"}h/night${prevAvgSleepH != null ? ` (last week ${prevAvgSleepH}h)` : ""}`,
    phoneOnly.length > 0
      ? `Nights the ring missed but the phone estimated: ${phoneOnly.map(n => `${n.day} ≈ ${hoursLabel(n.minutes)}`).join(", ")} — motion-based guesses, no stages or score; mention them as the phone's estimate, never fold them into the ring average`
      : null,
    `HRV: avg ${avgHrv ?? "no data"}ms${prevAvgHrv != null ? ` (last week ${prevAvgHrv}ms)` : ""}`,
    `Readiness: avg ${avgReadiness ?? "no data"}${prevAvgReadiness != null ? ` (last week ${prevAvgReadiness})` : ""}`,
    stepsLine(thisWeekLogs.map(l => l.steps), prevWeekLogs.map(l => l.steps)),
    avgStress != null ? `Daytime stress: avg ${avgStress}min elevated/day` : null,
    `Deep work: ${totalFocusMin}min across ${focusSessions.length} sessions`,
    stravaRows.length > 0 ? `Workouts: ${stravaRows.length}${workoutKm > 0 ? `, ${workoutKm.toFixed(1)}km` : ""}` : null,
    `Fluids (all drinks): ${totalFluidL}L logged`,
    avgMood != null ? `Mood: avg ${avgMood}/5` : null,
    `Morning check-ins: ${checkinRows.length}/${daysThisWeek}${avgCheckinEnergy != null ? `, avg energy ${avgCheckinEnergy}/5` : ""}`,
    habitRows.length > 0 ? `Habits (done / asked for by its schedule; skipped and vacation days excluded):\n${habitRows.map(h =>
      `  - ${h.name}: ${
        h.target != null
          ? h.due === 0 ? `${h.done} of ${h.target} this week so far, still within reach` : `${h.done}/${h.target} of its weekly target`
          : h.due === 0 ? "nothing due yet" : `${h.done}/${h.due} due days`
      }`,
    ).join("\n")}` : null,
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
    model: SONNET,
    // Thinking is on by default on this model and counts against the cap: at
    // 700 the review could spend its whole budget thinking and come back with
    // no prose, which read as "nothing to review". Length is set by the
    // prompt ("under 250 words"), not by this number.
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: instruction }],
  })
  recordModelTurn({ userId, model: SONNET, feature: "weekly review", stopReason: response.stop_reason, usage: response.usage })
  if (response.stop_reason === "refusal") return null

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
