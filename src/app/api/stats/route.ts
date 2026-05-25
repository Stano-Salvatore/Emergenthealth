import { auth } from "@/auth"
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

function pearson(pairs: [number, number][]): number | null {
  if (pairs.length < 7) return null
  const xs = pairs.map(p => p[0])
  const ys = pairs.map(p => p[1])
  const n = pairs.length
  const sx = xs.reduce((a, b) => a + b, 0)
  const sy = ys.reduce((a, b) => a + b, 0)
  const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0)
  const sx2 = xs.reduce((a, x) => a + x * x, 0)
  const sy2 = ys.reduce((a, y) => a + y * y, 0)
  const num = n * sxy - sx * sy
  const den = Math.sqrt((n * sx2 - sx ** 2) * (n * sy2 - sy ** 2))
  return den === 0 ? null : Math.max(-1, Math.min(1, num / den))
}

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

// Split pairs at median of X, return avg Y for each half
function medianSplit(pairs: [number, number][]) {
  if (pairs.length < 7) return null
  const sorted = [...pairs].sort((a, b) => a[0] - b[0])
  const mid = Math.floor(sorted.length / 2)
  const lowY = sorted.slice(0, mid).map(p => p[1])
  const highY = sorted.slice(mid).map(p => p[1])
  const median = sorted[mid][0]
  return {
    median,
    lowAvg: lowY.reduce((a, b) => a + b, 0) / lowY.length,
    highAvg: highY.reduce((a, b) => a + b, 0) / highY.length,
  }
}

function fmt(v: number, unit: string): string {
  if (unit === "h") return `${(v / 60).toFixed(1)}h`
  if (unit === "score") return Math.round(v).toString()
  if (unit === "steps") return Math.round(v).toLocaleString()
  if (unit === "ms") return `${Math.round(v)}ms`
  if (unit === "ml") return `${Math.round(v)}ml`
  if (unit === "mood") return ["", "😞", "😕", "😐", "🙂", "😊"][Math.round(v)] ?? Math.round(v).toString()
  if (unit === "%") return `${Math.round(v)}%`
  return Math.round(v).toString()
}

function buildInsight(
  aLabel: string,
  bLabel: string,
  bUnit: string,
  lag: number,
  r: number,
  split: ReturnType<typeof medianSplit>,
): string {
  const lagStr = lag === 1 ? " the next day" : lag === -1 ? " the previous day" : ""
  const when = split ? `When ${aLabel} is high: ${fmt(split.highAvg, bUnit)}${lagStr} vs ${fmt(split.lowAvg, bUnit)} when low.` : ""
  if (Math.abs(r) < 0.2) return `Weak link between ${aLabel} and ${bLabel}${lagStr}. ${when}`
  const dir = r > 0 ? "higher" : "lower"
  return `Higher ${aLabel} → ${dir} ${bLabel}${lagStr}. ${when}`
}

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user!.id!

  const since30 = subDays(new Date(), 29)
  const since90 = subDays(new Date(), 89)

  const [logs, focusSessions, intakeLogs, moodLogs, habitCompletions, habits] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since90 } },
      orderBy: { date: "asc" },
      select: {
        date: true, sleepDuration: true, sleepScore: true, steps: true,
        readinessScore: true, activityScore: true, hrv: true,
        sleepStart: true, sleepEnd: true, sleepEfficiency: true,
        caloriesBurned: true, activeMinutes: true, stressHigh: true,
      },
    }),
    prisma.focusSession.findMany({
      where: { userId, endedAt: { gte: since90 }, type: "focus" },
      select: { durationMin: true, endedAt: true },
    }).catch(() => [] as { durationMin: number; endedAt: Date }[]),
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: since90 } },
      select: { amountMl: true, loggedAt: true, type: true },
    }).catch(() => [] as { amountMl: number; loggedAt: Date; type: string }[]),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since90 } },
      select: { date: true, mood: true },
    }).catch(() => [] as { date: Date; mood: number }[]),
    prisma.habitCompletion.findMany({
      where: { userId, date: { gte: since90 } },
      select: { date: true },
    }).catch(() => [] as { date: Date }[]),
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      select: { id: true },
    }).catch(() => [] as { id: string }[]),
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
  const bestSleepDay = allLogs.filter(l => l.sleepDuration != null)
    .reduce<typeof allLogs[0] | null>((b, l) => !b || l.sleepDuration! > b.sleepDuration! ? l : b, null)
  const bestStepsDay = allLogs.filter(l => l.steps != null)
    .reduce<typeof allLogs[0] | null>((b, l) => !b || l.steps! > b.steps! ? l : b, null)
  const bestReadinessDay = allLogs.filter(l => l.readinessScore != null)
    .reduce<typeof allLogs[0] | null>((b, l) => !b || l.readinessScore! > b.readinessScore! ? l : b, null)
  const bestHrvDay = allLogs.filter(l => l.hrv != null)
    .reduce<typeof allLogs[0] | null>((b, l) => !b || l.hrv! > b.hrv! ? l : b, null)

  // ── Water streak ─────────────────────────────────────────────────────────────
  const waterByDay: Record<string, number> = {}
  for (const w of intakeLogs.filter(i => i.type === "water")) {
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
  const hrvTrend = Math.abs(hrvSlope) < 0.05 ? "stable" : hrvSlope > 0 ? "improving" : "declining"

  // ── Sleep consistency ────────────────────────────────────────────────────────
  const bedtimes = recent30
    .filter(l => l.sleepStart != null)
    .map(l => {
      const t = new Date(l.sleepStart!)
      let mins = t.getHours() * 60 + t.getMinutes()
      mins = mins >= 18 * 60 ? mins - 18 * 60 : mins + 6 * 60
      return mins
    })
  const bedtimeStdDev = stddev(bedtimes)
  const sleepConsistency = bedtimeStdDev == null ? null
    : bedtimeStdDev < 30 ? "consistent"
    : bedtimeStdDev < 60 ? "moderate"
    : "irregular"
  const avgBedtimeMin = bedtimes.length ? bedtimes.reduce((a, b) => a + b, 0) / bedtimes.length : null
  const avgBedtime = avgBedtimeMin != null
    ? (() => {
        const totalMin = Math.round(avgBedtimeMin) + 18 * 60
        const h = Math.floor(totalMin / 60) % 24
        const m = totalMin % 60
        return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`
      })()
    : null

  // ── Correlations engine ───────────────────────────────────────────────────────
  // Build per-day lookup maps
  const healthByDate = Object.fromEntries(allLogs.map(l => [l.date.toISOString().split("T")[0], l]))
  const moodByDate = Object.fromEntries(moodLogs.map(m => [m.date.toISOString().split("T")[0], m.mood]))

  // Focus: total minutes per day
  const focusByDate: Record<string, number> = {}
  for (const s of focusSessions) {
    const d = format(new Date(s.endedAt), "yyyy-MM-dd")
    focusByDate[d] = (focusByDate[d] ?? 0) + s.durationMin
  }

  // Coffee: total ml per day
  const coffeeByDate: Record<string, number> = {}
  for (const i of intakeLogs.filter(x => x.type === "coffee")) {
    const d = format(new Date(i.loggedAt), "yyyy-MM-dd")
    coffeeByDate[d] = (coffeeByDate[d] ?? 0) + i.amountMl
  }

  // Habit completion rate per day (0-1): completions / total active habits
  const totalHabits = habits.length
  const habitsByDate: Record<string, number> = {}
  if (totalHabits > 0) {
    for (const c of habitCompletions) {
      const d = c.date.toISOString().split("T")[0]
      habitsByDate[d] = ((habitsByDate[d] ?? 0) + 1) / totalHabits
    }
  }

  const allDateStrs = Object.keys(healthByDate).sort()

  function nextDay(d: string) {
    const dt = new Date(d + "T12:00:00Z")
    dt.setDate(dt.getDate() + 1)
    return dt.toISOString().split("T")[0]
  }

  type Getter = (d: string) => number | null
  const H = (field: keyof typeof allLogs[0]) => (d: string) => {
    const l = healthByDate[d]
    return l ? (l[field] as number | null | undefined) ?? null : null
  }
  const mood: Getter = d => moodByDate[d] ?? null
  const focus: Getter = d => focusByDate[d] ?? null
  const coffee: Getter = d => coffeeByDate[d] != null ? coffeeByDate[d] : null
  const habitRate: Getter = d => habitsByDate[d] ?? null
  const sleepH: Getter = d => { const v = H("sleepDuration")(d); return v != null ? v / 60 : null }

  function buildCorr(
    key: string, label: string, emoji: string,
    xFn: Getter, yFn: Getter, yUnit: string,
    aLabel: string, bLabel: string, lag: number,
    dates = allDateStrs,
  ) {
    const pairs: [number, number][] = []
    for (const d of dates) {
      const target = lag === 1 ? nextDay(d) : d
      const x = xFn(d), y = yFn(target)
      if (x != null && y != null) pairs.push([x, y])
    }
    const r = pearson(pairs)
    const n = pairs.length
    const split = r != null ? medianSplit(pairs) : null
    const insight = r != null
      ? buildInsight(aLabel, bLabel, yUnit, lag, r, split)
      : `Need more data (${n} days so far — aim for 14+)`
    const strength = r == null ? "insufficient"
      : Math.abs(r) >= 0.5 ? "strong"
      : Math.abs(r) >= 0.3 ? "moderate"
      : Math.abs(r) >= 0.15 ? "weak"
      : "none"
    return { key, label, emoji, r, n, insight, strength, direction: r == null ? null : r >= 0 ? "positive" : "negative" }
  }

  const correlations = [
    buildCorr("sleep_next_readiness", "Sleep → Next-day readiness", "⚡",
      H("sleepScore"), H("readinessScore"), "score", "sleep score", "readiness", 1),
    buildCorr("sleep_next_steps",     "Sleep → Next-day steps", "🦶",
      H("sleepScore"), H("steps"), "steps", "sleep score", "step count", 1),
    buildCorr("sleep_next_focus",     "Sleep → Next-day focus", "🧠",
      H("sleepScore"), focus, "h", "sleep score", "focus time", 1),
    buildCorr("sleep_mood",           "Sleep → Mood", "😊",
      H("sleepScore"), mood, "mood", "sleep score", "mood", 0),
    buildCorr("hrv_mood",             "HRV → Mood", "💜",
      H("hrv"), mood, "mood", "HRV", "mood", 0),
    buildCorr("hrv_next_readiness",   "HRV → Next-day readiness", "🔋",
      H("hrv"), H("readinessScore"), "score", "HRV", "readiness", 1),
    buildCorr("steps_next_sleep",     "Steps → Next-night sleep", "🏃",
      H("steps"), H("sleepScore"), "score", "step count", "sleep score", 1),
    buildCorr("steps_next_readiness", "Steps → Next-day readiness", "🔄",
      H("steps"), H("readinessScore"), "score", "step count", "readiness", 1),
    buildCorr("readiness_steps",      "Readiness → Steps", "📈",
      H("readinessScore"), H("steps"), "steps", "readiness score", "step count", 0),
    buildCorr("focus_mood",           "Focus → Mood", "🎯",
      focus, mood, "mood", "focus time", "mood", 0),
    buildCorr("focus_next_sleep",     "Focus → Next-night sleep", "💤",
      focus, H("sleepScore"), "score", "focus time", "sleep score", 1),
    buildCorr("coffee_sleep",         "Coffee → Same-night sleep", "☕",
      coffee, H("sleepScore"), "score", "coffee intake", "sleep score", 0),
    buildCorr("coffee_next_sleep",    "Coffee → Next-night sleep", "☕",
      coffee, H("sleepScore"), "score", "coffee intake", "sleep score", 1),
    buildCorr("habits_mood",          "Habits → Mood", "✅",
      habitRate, mood, "mood", "habit completion", "mood", 0),
    buildCorr("habits_next_sleep",    "Habits → Next-night sleep", "🌙",
      habitRate, H("sleepScore"), "score", "habit completion", "sleep score", 1),
    buildCorr("stress_sleep",         "Stress → Sleep", "😰",
      H("stressHigh"), H("sleepScore"), "score", "high-stress time", "sleep score", 0),
    buildCorr("active_next_sleep",    "Active minutes → Sleep", "🏋️",
      H("activeMinutes"), H("sleepScore"), "score", "active minutes", "sleep score", 1),
    buildCorr("sleep_dur_focus",      "Sleep duration → Focus", "⏰",
      sleepH, focus, "h", "hours slept", "focus time", 0),
  ].sort((a, b) => {
    // Sort: strong > moderate > weak > insufficient, then by |r| desc
    const order = { strong: 0, moderate: 1, weak: 2, none: 3, insufficient: 4 }
    const so = order[a.strength as keyof typeof order] - order[b.strength as keyof typeof order]
    if (so !== 0) return so
    return (Math.abs(b.r ?? 0)) - (Math.abs(a.r ?? 0))
  })

  return NextResponse.json({
    dowStats,
    focusDowStats,
    trendData,
    bestSleepDay: bestSleepDay ? { date: format(bestSleepDay.date, "MMM d"), sleepH: (bestSleepDay.sleepDuration! / 60).toFixed(1) } : null,
    bestStepsDay: bestStepsDay ? { date: format(bestStepsDay.date, "MMM d"), steps: bestStepsDay.steps!.toLocaleString() } : null,
    bestReadinessDay: bestReadinessDay ? { date: format(bestReadinessDay.date, "MMM d"), score: bestReadinessDay.readinessScore! } : null,
    bestHrvDay: bestHrvDay ? { date: format(bestHrvDay.date, "MMM d"), hrv: Math.round(bestHrvDay.hrv!) } : null,
    waterStreak,
    totalFocusMin30: focusSessions.filter(s => s.endedAt >= since30).reduce((a, s) => a + s.durationMin, 0),
    stepStreak,
    sleepStreak,
    hrvTrend,
    hrvAvg7: avgF(trend7.map(l => l.hrv)),
    sleepConsistency,
    avgBedtime,
    bedtimeStdDevMin: bedtimeStdDev != null ? Math.round(bedtimeStdDev) : null,
    correlations,
    dataPoints: allDateStrs.length,
  })
}
