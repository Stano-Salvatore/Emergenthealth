import { auth } from "@/auth"
import { getUserTimezone } from "@/lib/user-timezone"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { subDays, format } from "date-fns"

function avg(arr: number[]) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function avgF(arr: (number | null)[]) {
  const v = arr.filter((x): x is number => x != null)
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}

function stddev(arr: number[]) {
  if (arr.length < 2) return null
  const m = arr.reduce((a, b) => a + b, 0) / arr.length
  return Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / arr.length)
}

// Linear regression slope (for trend direction)
function slope(ys: number[]): number {
  const n = ys.length
  if (n < 3) return 0
  const xs = Array.from({ length: n }, (_, i) => i)
  const sx = xs.reduce((a, b) => a + b, 0)
  const sy = ys.reduce((a, b) => a + b, 0)
  const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0)
  const sx2 = xs.reduce((a, x) => a + x * x, 0)
  return (n * sxy - sx * sy) / (n * sx2 - sx ** 2)
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const since30 = subDays(new Date(), 29)
  const since90 = subDays(new Date(), 89)

  const [logs, focusSessions, intakeLogs] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since90 } },
      orderBy: { date: "asc" },
      select: {
        date: true, sleepDuration: true, sleepScore: true, steps: true,
        readinessScore: true, activityScore: true, hrv: true,
        sleepStart: true, sleepEnd: true, sleepEfficiency: true,
        caloriesBurned: true, activeMinutes: true,
      },
    }),
    prisma.focusSession.findMany({
      where: { userId, endedAt: { gte: since30 }, type: "focus" },
      select: { durationMin: true, endedAt: true },
    }).catch(() => [] as { durationMin: number; endedAt: Date }[]),
    // The water streak looks back 31 days at most — no need for the 90-day window.
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: subDays(new Date(), 31) } },
      select: { amountMl: true, loggedAt: true, type: true },
    }).catch(() => [] as { amountMl: number; loggedAt: Date; type: string }[]),
  ])

  const recent30 = logs.filter(l => l.date >= since30)

  // ── Day-of-week patterns ─────────────────────────────────────────────────────
  const byDow: Record<number, { sleep: number[]; steps: number[]; readiness: number[] }> = {}
  for (let i = 0; i < 7; i++) byDow[i] = { sleep: [], steps: [], readiness: [] }
  for (const l of recent30) {
    const dow = l.date.getDay()
    if (l.sleepDuration != null) byDow[dow].sleep.push(l.sleepDuration / 60)
    if (l.steps != null) byDow[dow].steps.push(l.steps)
    if (l.readinessScore != null) byDow[dow].readiness.push(l.readinessScore)
  }
  const dowStats = [0, 1, 2, 3, 4, 5, 6].map(d => ({
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d],
    avgSleep: avg(byDow[d].sleep),
    avgSteps: avg(byDow[d].steps),
    avgReadiness: avg(byDow[d].readiness),
  }))

  const focusByDow: Record<number, number[]> = {}
  for (let i = 0; i < 7; i++) focusByDow[i] = []
  for (const s of focusSessions) {
    focusByDow[new Date(s.endedAt).getDay()].push(s.durationMin)
  }
  const focusDowStats = [0, 1, 2, 3, 4, 5, 6].map(d => ({
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d],
    avgFocusMin: avg(focusByDow[d]),
  }))

  // ── Week-over-week trends ────────────────────────────────────────────────────
  const sorted30 = [...recent30].sort((a, b) => b.date.getTime() - a.date.getTime())
  const trend7 = sorted30.slice(0, 7)
  const prev7 = sorted30.slice(7, 14)
  const trendData = {
    sleep: {
      current: avgF(trend7.map(l => l.sleepDuration != null ? l.sleepDuration / 60 : null)),
      prev: avgF(prev7.map(l => l.sleepDuration != null ? l.sleepDuration / 60 : null)),
    },
    steps: { current: avgF(trend7.map(l => l.steps)), prev: avgF(prev7.map(l => l.steps)) },
    readiness: { current: avgF(trend7.map(l => l.readinessScore)), prev: avgF(prev7.map(l => l.readinessScore)) },
    hrv: { current: avgF(trend7.map(l => l.hrv)), prev: avgF(prev7.map(l => l.hrv)) },
  }

  // ── Personal records ─────────────────────────────────────────────────────────
  const allLogs = [...logs].sort((a, b) => b.date.getTime() - a.date.getTime())
  const sleepLogs = allLogs.filter(l => l.sleepDuration != null)
  const bestSleepDay = sleepLogs.length
    ? sleepLogs.reduce((b, l) => l.sleepDuration! > b.sleepDuration! ? l : b)
    : null
  const bestStepsDay = allLogs.filter(l => l.steps != null)
    .reduce<typeof allLogs[0] | null>((b, l) => !b || l.steps! > b.steps! ? l : b, null)
  const bestReadinessDay = allLogs.filter(l => l.readinessScore != null)
    .reduce<typeof allLogs[0] | null>((b, l) => !b || l.readinessScore! > b.readinessScore! ? l : b, null)
  const bestHrvDay = allLogs.filter(l => l.hrv != null)
    .reduce<typeof allLogs[0] | null>((b, l) => !b || l.hrv! > b.hrv! ? l : b, null)

  // ── Water streak ─────────────────────────────────────────────────────────────
  const waterByDay: Record<string, number> = {}
  for (const w of intakeLogs) {
    if (w.type === "alcohol" || w.type === "coffee") continue
    const d = format(new Date(w.loggedAt), "yyyy-MM-dd")
    waterByDay[d] = (waterByDay[d] ?? 0) + w.amountMl
  }
  let waterStreak = 0
  const wCursor = new Date()
  while (waterStreak <= 30) {
    const d = format(wCursor, "yyyy-MM-dd")
    if ((waterByDay[d] ?? 0) >= 2000) { waterStreak++; wCursor.setDate(wCursor.getDate() - 1) }
    else break
  }

  // ── Goal streaks ─────────────────────────────────────────────────────────────
  const STEP_GOAL = 8000
  const SLEEP_GOAL_MIN = 7 * 60
  const descLogs = [...allLogs].sort((a, b) => b.date.getTime() - a.date.getTime())
  let stepStreak = 0, sleepStreak = 0
  for (const l of descLogs) {
    if (l.steps != null && l.steps >= STEP_GOAL) stepStreak++
    else break
  }
  for (const l of descLogs) {
    if (l.sleepDuration != null && l.sleepDuration >= SLEEP_GOAL_MIN) sleepStreak++
    else break
  }

  // ── HRV 30-day trend ─────────────────────────────────────────────────────────
  const hrvSeries = recent30.filter(l => l.hrv != null).map(l => l.hrv!)
  const hrvSlope = slope(hrvSeries)
  const hrvTrend = Math.abs(hrvSlope) < 0.05 ? "stable"
    : hrvSlope > 0 ? "improving"
    : "declining"

  // ── Sleep consistency ────────────────────────────────────────────────────────
  // Bedtime in minutes since 6pm (handles midnight crossover).
  //
  // Read in the USER'S timezone. `getHours()` on a server running in UTC gave
  // the UTC hour, so a bedtime of 23:20 in Bratislava was averaged — and
  // displayed — as 21:20. The spread was unaffected, being a constant offset,
  // so the page said "consistent" about a number that was two hours wrong.
  const clockFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: await getUserTimezone(userId),
    hour12: false, hour: "2-digit", minute: "2-digit",
  })
  const bedtimes = recent30
    .filter(l => l.sleepStart != null)
    .map(l => {
      const parts: Record<string, string> = {}
      for (const part of clockFmt.formatToParts(new Date(l.sleepStart!))) {
        if (part.type !== "literal") parts[part.type] = part.value
      }
      let mins = (Number(parts.hour) % 24) * 60 + Number(parts.minute)
      // Normalise: shift so 6pm = 0; times before 6pm are assumed next-day
      mins = mins >= 18 * 60 ? mins - 18 * 60 : mins + 6 * 60
      return mins
    })
  const bedtimeStdDev = stddev(bedtimes)
  const sleepConsistency = bedtimeStdDev == null ? null
    : bedtimeStdDev < 30 ? "consistent"
    : bedtimeStdDev < 60 ? "moderate"
    : "irregular"
  const avgBedtimeMin = bedtimes.length
    ? bedtimes.reduce((a, b) => a + b, 0) / bedtimes.length
    : null
  const avgBedtime = avgBedtimeMin != null
    ? (() => {
        const totalMin = Math.round(avgBedtimeMin) + 18 * 60
        const h = Math.floor(totalMin / 60) % 24
        const m = totalMin % 60
        // 24-hour, like the clock on the dashboard and every other time in
        // the app. "11:20 PM" was the only 12-hour reading in the product.
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      })()
    : null

  // Distinct health-log days in the window — the page's "Patterns from N days" line.
  const dataPoints = new Set(allLogs.map(l => l.date.toISOString().split("T")[0])).size

  return NextResponse.json({
    dowStats,
    focusDowStats,
    trendData,
    bestSleepDay: bestSleepDay ? { date: format(bestSleepDay.date, "MMM d"), sleepH: (bestSleepDay.sleepDuration! / 60).toFixed(1) } : null,
    bestStepsDay: bestStepsDay ? { date: format(bestStepsDay.date, "MMM d"), steps: bestStepsDay.steps!.toLocaleString() } : null,
    bestReadinessDay: bestReadinessDay ? { date: format(bestReadinessDay.date, "MMM d"), score: bestReadinessDay.readinessScore! } : null,
    bestHrvDay: bestHrvDay ? { date: format(bestHrvDay.date, "MMM d"), hrv: Math.round(bestHrvDay.hrv!) } : null,
    waterStreak,
    totalFocusMin30: focusSessions.reduce((a, s) => a + s.durationMin, 0),
    stepStreak,
    sleepStreak,
    hrvTrend,
    hrvAvg7: avgF(trend7.map(l => l.hrv)),
    sleepConsistency,
    avgBedtime,
    bedtimeStdDevMin: bedtimeStdDev != null ? Math.round(bedtimeStdDev) : null,
    dataPoints,
  })
}
