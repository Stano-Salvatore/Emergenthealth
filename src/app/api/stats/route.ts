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

// Pearson correlation: returns null if insufficient data
function pearson(pairs: [number, number][]): number | null {
  if (pairs.length < 5) return null
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

  const [logs, focusSessions, intakeLogs, moodLogs, customMetrics, customLogs] = await Promise.all([
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
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: since30 }, type: "water" },
      select: { amountMl: true, loggedAt: true },
    }).catch(() => [] as { amountMl: number; loggedAt: Date }[]),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since90 } },
      select: { date: true, mood: true },
    }).catch(() => [] as { date: Date; mood: number }[]),
    prisma.$queryRaw<{ id: string; name: string; emoji: string; color: string; type: string }[]>`
      SELECT "id","name","emoji","color","type" FROM "CustomMetric" WHERE "userId" = ${userId}
    `.catch(() => []),
    prisma.$queryRaw<{ metricId: string; date: string; value: number }[]>`
      SELECT "metricId", "date"::text, "value"
      FROM "CustomMetricLog"
      WHERE "userId" = ${userId}
        AND "date" >= CURRENT_DATE - INTERVAL '90 days'
      ORDER BY "date" ASC
    `.catch(() => []),
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
  // Bedtime in minutes since 6pm (handles midnight crossover)
  const bedtimes = recent30
    .filter(l => l.sleepStart != null)
    .map(l => {
      const t = new Date(l.sleepStart!)
      let mins = t.getHours() * 60 + t.getMinutes()
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
        return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`
      })()
    : null

  // ── Correlations ─────────────────────────────────────────────────────────────
  // Build a date-indexed map across all data
  const moodByDate = Object.fromEntries(moodLogs.map(m => [
    m.date.toISOString().split("T")[0], m.mood,
  ]))
  const healthByDate = Object.fromEntries(allLogs.map(l => [
    l.date.toISOString().split("T")[0], l,
  ]))

  // Helper: get value for date
  const get = (dateStr: string, field: keyof typeof allLogs[0]) => {
    const l = healthByDate[dateStr]
    return l ? (l[field] as number | null | undefined) ?? null : null
  }
  const getMood = (dateStr: string) => moodByDate[dateStr] ?? null
  const nextDay = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00Z")
    d.setDate(d.getDate() + 1)
    return d.toISOString().split("T")[0]
  }

  const allDateStrs = Object.keys(healthByDate).sort()

  function corr(
    xFn: (d: string) => number | null,
    yFn: (d: string) => number | null,
    dates = allDateStrs,
  ) {
    const pairs: [number, number][] = []
    for (const d of dates) {
      const x = xFn(d), y = yFn(d)
      if (x != null && y != null) pairs.push([x, y])
    }
    return { r: pearson(pairs), n: pairs.length }
  }

  const correlations = [
    {
      key: "steps_sleep",
      label: "Steps → Sleep score",
      ...corr(d => get(d, "steps"), d => get(d, "sleepScore")),
      insight: (r: number) => r > 0.3
        ? `Active days (more steps) correlate with higher sleep scores (+${Math.round(r * 100)}% link)`
        : r < -0.3
        ? `Surprisingly, heavier step days here link to slightly lower sleep`
        : "No strong link between your step count and sleep quality yet",
      emoji: "🦶",
    },
    {
      key: "sleep_readiness_next",
      label: "Sleep → Next-day readiness",
      ...corr(d => get(d, "sleepScore"), d => get(nextDay(d), "readinessScore")),
      insight: (r: number) => r > 0.3
        ? `Good sleep reliably predicts higher readiness the next day (+${Math.round(r * 100)}% link)`
        : r < -0.3
        ? `Sleep quality and next-day readiness appear inversely linked in your data`
        : "Sleep score and next-day readiness aren't strongly linked yet",
      emoji: "⚡",
    },
    {
      key: "hrv_mood",
      label: "HRV → Mood",
      ...corr(d => get(d, "hrv"), d => getMood(d)),
      insight: (r: number) => r > 0.3
        ? `Higher HRV days consistently match better mood (+${Math.round(r * 100)}% link)`
        : r < -0.3
        ? `Interesting inverse: your highest HRV days aren't your happiest`
        : "HRV and mood don't show a strong pattern yet",
      emoji: "💜",
    },
    {
      key: "steps_readiness_next",
      label: "Steps → Next-day readiness",
      ...corr(d => get(d, "steps"), d => get(nextDay(d), "readinessScore")),
      insight: (r: number) => r > 0.3
        ? `Active days lead to better recovery — higher steps predict better next-day readiness`
        : r < -0.3
        ? `Heavy activity days seem to lower your readiness the day after — you may need more recovery time`
        : "No clear pattern between activity level and recovery yet",
      emoji: "🔄",
    },
    {
      key: "sleep_mood",
      label: "Sleep → Mood",
      ...corr(d => get(d, "sleepScore"), d => getMood(d)),
      insight: (r: number) => r > 0.3
        ? `Better sleep nights lead to noticeably better mood (+${Math.round(r * 100)}% link)`
        : r < -0.3
        ? `Your mood doesn't seem to follow your sleep quality — other factors may dominate`
        : "Sleep and mood link isn't clear enough yet — need more mood logs",
      emoji: "😊",
    },
    {
      key: "readiness_steps",
      label: "Readiness → Steps",
      ...corr(d => get(d, "readinessScore"), d => get(d, "steps")),
      insight: (r: number) => r > 0.3
        ? `High-readiness days, you naturally move more — body and behaviour are in sync`
        : r < -0.3
        ? `You actually push harder on low-readiness days — watch out for overtraining`
        : "Readiness score and daily steps don't strongly predict each other yet",
      emoji: "🏃",
    },
  ]

  const richCorrelations = correlations.map(c => ({
    key: c.key,
    label: c.label,
    r: c.r,
    n: c.n,
    emoji: c.emoji,
    insight: c.r != null ? c.insight(c.r) : `Need at least 5 paired data points (have ${c.n})`,
    strength: c.r == null ? "insufficient"
      : Math.abs(c.r) >= 0.5 ? "strong"
      : Math.abs(c.r) >= 0.25 ? "moderate"
      : "weak",
    direction: c.r == null ? null : c.r >= 0 ? "positive" : "negative",
    isCustom: false,
  }))

  // ── Custom metric correlations ───────────────────────────────────────────────
  // Build date→value map for each custom metric
  const customByMetric: Record<string, Record<string, number>> = {}
  for (const l of customLogs) {
    const date = l.date.slice(0, 10)
    if (!customByMetric[l.metricId]) customByMetric[l.metricId] = {}
    customByMetric[l.metricId][date] = l.value
  }

  const healthTargets: { key: string; label: string; fn: (d: string) => number | null }[] = [
    { key: "sleep",     label: "sleep score",  fn: d => get(d, "sleepScore") },
    { key: "readiness", label: "readiness",    fn: d => get(d, "readinessScore") },
    { key: "hrv",       label: "HRV",          fn: d => get(d, "hrv") },
    { key: "steps",     label: "step count",   fn: d => get(d, "steps") },
    { key: "mood",      label: "mood",         fn: getMood },
  ]

  const customCorrelations: typeof richCorrelations = []

  for (const metric of customMetrics) {
    const metricByDate = customByMetric[metric.id] ?? {}
    const metricDates = Object.keys(metricByDate)
    if (metricDates.length < 7) continue

    // For each health target, compute correlation
    const pairs: { target: typeof healthTargets[0]; r: number | null; n: number }[] = []
    for (const target of healthTargets) {
      const { r, n } = corr(d => metricByDate[d] ?? null, target.fn, allDateStrs)
      pairs.push({ target, r, n })
    }

    // Keep the pair with highest |r| that has enough data
    const best = pairs
      .filter(p => p.n >= 7 && p.r != null)
      .sort((a, b) => Math.abs(b.r!) - Math.abs(a.r!))
      .slice(0, 2)

    for (const { target, r, n } of best) {
      const abs = r != null ? Math.abs(r) : 0
      const dir = r != null ? (r >= 0 ? "higher" : "lower") : ""
      const inv = r != null ? (r >= 0 ? "lower" : "higher") : ""
      customCorrelations.push({
        key: `custom_${metric.id}_${target.key}`,
        label: `${metric.name} → ${target.label}`,
        r,
        n,
        emoji: metric.emoji,
        insight: r == null
          ? `Need more data to detect a pattern`
          : abs >= 0.4
          ? `Strong link: ${dir} ${metric.name} correlates with ${dir} ${target.label} (r=${r.toFixed(2)}, ${n} days)`
          : abs >= 0.2
          ? `Moderate pattern: ${dir} ${metric.name} tends to go with ${dir} ${target.label} (r=${r.toFixed(2)}, ${n} days)`
          : `Weak or no link between ${metric.name} and ${target.label} so far (r=${r.toFixed(2)}, ${n} days)`,
        strength: abs >= 0.5 ? "strong" : abs >= 0.25 ? "moderate" : "weak",
        direction: r == null ? null : r >= 0 ? "positive" : "negative",
        isCustom: true,
      })
    }
  }

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
    correlations: richCorrelations,
    customCorrelations,
    dataPoints: allDateStrs.length,
  })
}
