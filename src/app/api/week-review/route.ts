import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import Anthropic from "@anthropic-ai/sdk"
import { format, startOfWeek, subDays } from "date-fns"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SLEEP_GOAL_H = 7.5
const STEP_GOAL = 8000

function avg(arr: (number | null | undefined)[]): number | null {
  const vals = arr.filter((v): v is number => v != null)
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "AI not configured" }, { status: 503 })

  const userId = session.user.id
  const today = new Date()
  const weekStart = startOfWeek(today, { weekStartsOn: 1 })
  const prevWeekStart = subDays(weekStart, 7)
  const prevWeekEnd = subDays(weekStart, 1)
  const weekStartStr = format(weekStart, "yyyy-MM-dd")
  const todayStr = format(today, "yyyy-MM-dd")

  const [thisWeekLogs, prevWeekLogs, habits, focusSessions, moodLogs, intakeLogs, checkinRows] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: weekStart, lte: today } },
      select: { date: true, sleepDuration: true, steps: true, hrv: true, readinessScore: true, weight: true, activityScore: true },
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
    }).catch(() => []),
    prisma.moodLog.findMany({ where: { userId, date: { gte: weekStart, lte: today } }, select: { mood: true } }),
    prisma.intakeLog.findMany({
      where: { userId, type: "water", loggedAt: { gte: weekStart, lte: today } },
      select: { amountMl: true },
    }).catch(() => []),
    prisma.$queryRaw<{ date: string; energy: number; mood: number; intention: string | null }[]>`
      SELECT "date", "energy", "mood", "intention" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" >= ${weekStartStr} AND "date" <= ${todayStr}
      ORDER BY "date" ASC
    `.catch(() => []),
  ])

  const daysThisWeek = Math.max(1, Math.round((today.getTime() - weekStart.getTime()) / 86400000) + 1)

  const avgSleepMin = avg(thisWeekLogs.map(l => l.sleepDuration))
  const avgSleepH = avgSleepMin != null ? Math.round((avgSleepMin / 60) * 10) / 10 : null
  const prevAvgSleepH = avg(prevWeekLogs.map(l => l.sleepDuration)) != null
    ? Math.round((avg(prevWeekLogs.map(l => l.sleepDuration))! / 60) * 10) / 10
    : null

  const avgHrv = avg(thisWeekLogs.map(l => l.hrv))
  const prevAvgHrv = avg(prevWeekLogs.map(l => l.hrv))
  const avgReadiness = avg(thisWeekLogs.map(l => l.readinessScore))
  const totalSteps = thisWeekLogs.reduce((s, l) => s + (l.steps ?? 0), 0)
  const stepGoalDays = thisWeekLogs.filter(l => (l.steps ?? 0) >= STEP_GOAL).length

  const totalFocusMin = focusSessions.reduce((s, f) => s + f.durationMin, 0)
  const avgMood = avg(moodLogs.map(m => m.mood))
  const totalWaterL = (intakeLogs.reduce((s, i) => s + i.amountMl, 0) / 1000).toFixed(1)

  const habitRows = habits.map(h => ({
    name: h.name,
    completed: h.completions.length,
    target: daysThisWeek,
    pct: Math.round((h.completions.length / daysThisWeek) * 100),
  }))
  const habitCompletionRate = habitRows.length > 0
    ? Math.round(habitRows.reduce((s, h) => s + h.pct, 0) / habitRows.length)
    : null

  const checkinCount = checkinRows.length
  const avgCheckinEnergy = avg(checkinRows.map(c => c.energy))
  const avgCheckinMood = avg(checkinRows.map(c => c.mood))

  const userName = session.user.name?.split(" ")[0] ?? "there"
  const weekStr = `week of ${format(weekStart, "MMMM d")}`

  const prompt = `You are a warm, insightful health coach reviewing someone's week. Write a concise, personalized 3-4 paragraph narrative about their ${weekStr}. Be specific about their numbers, highlight patterns, give one actionable suggestion, and end with an encouraging note. Keep it under 200 words. Write in second person ("you").

User: ${userName}
Days tracked: ${daysThisWeek}

HEALTH DATA:
- Sleep: avg ${avgSleepH ?? "no data"}h/night (goal: ${SLEEP_GOAL_H}h)${prevAvgSleepH ? `, prev week: ${prevAvgSleepH}h` : ""}
- HRV: avg ${avgHrv ?? "no data"}ms${prevAvgHrv ? `, prev week: ${prevAvgHrv}ms` : ""}
- Readiness: avg ${avgReadiness ?? "no data"}/100
- Steps: ${totalSteps.toLocaleString()} total, ${stepGoalDays}/${daysThisWeek} days hit ${STEP_GOAL.toLocaleString()} goal
- Focus sessions: ${totalFocusMin}min total (${Math.round(totalFocusMin / daysThisWeek)}min/day avg)
- Water: ${totalWaterL}L total
- Mood: avg ${avgMood ?? "no data"}/5
- Habit completion: ${habitCompletionRate ?? "no data"}%
- Morning check-ins: ${checkinCount}/${daysThisWeek} days${avgCheckinEnergy ? `, avg energy ${avgCheckinEnergy}/5` : ""}
${habitRows.length > 0 ? `\nHABITS:\n${habitRows.map(h => `- ${h.name}: ${h.completed}/${h.target} days (${h.pct}%)`).join("\n")}` : ""}

Write the narrative now.`

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  })

  const narrative = response.content
    .filter(c => c.type === "text")
    .map(c => (c as { type: "text"; text: string }).text)
    .join("")

  return NextResponse.json({ narrative, generatedAt: new Date().toISOString() })
}
