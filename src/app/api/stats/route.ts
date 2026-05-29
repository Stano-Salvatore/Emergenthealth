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

type CorrResult = { r: number | null; n: number; sparkPoints: { x: number; y: number }[] }

export async function GET() {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const since30 = subDays(new Date(), 29)
  const since90 = subDays(new Date(), 89)

  const [logs, focusSessions, intakeLogs, moodLogs, customMetrics, customLogs, weatherLogs, lastfmLogs, checkinLogs, transactions] = await Promise.all([
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
      where: { userId, loggedAt: { gte: since90 } },
      select: { amountMl: true, loggedAt: true, type: true },
    }).catch(() => [] as { amountMl: number; loggedAt: Date; type: string }[]),
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
    prisma.$queryRaw<{ date: string; tempMaxC: number | null; precipMm: number | null; uvIndex: number | null }[]>`
      SELECT "date","tempMaxC","precipMm","uvIndex"
      FROM "WeatherLog"
      WHERE "userId" = ${userId}
        AND "date" >= (CURRENT_DATE - INTERVAL '90 days')::text
      ORDER BY "date" ASC
    `.catch(() => []),
    prisma.$queryRaw<{date: string, listeningMin: number, tracksPlayed: number}[]>`
      SELECT "date", "listeningMin", "tracksPlayed"
      FROM "LastfmLog" WHERE "userId" = ${userId}
      AND "date" >= ${format(since90, 'yyyy-MM-dd')}
      ORDER BY "date" ASC
    `.catch(() => [] as {date: string, listeningMin: number, tracksPlayed: number}[]),
    prisma.$queryRaw<{date: string, energy: number, mood: number}[]>`
      SELECT "date", "energy", "mood"
      FROM "MorningCheckIn" WHERE "userId" = ${userId}
      AND "date" >= ${format(since90, 'yyyy-MM-dd')}
      ORDER BY "date" ASC
    `.catch(() => [] as {date: string, energy: number, mood: number}[]),
    prisma.transaction.findMany({
      where: { userId, date: { gte: since90 }, isTransfer: false, amount: { lt: 0 } },
      select: { date: true, amount: true },
    }).catch(() => [] as { date: Date; amount: number }[]),
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
  const alcoholByDay: Record<string, number> = {}
  const coffeeByDay: Record<string, number> = {}
  for (const w of intakeLogs) {
    const d = format(new Date(w.loggedAt), "yyyy-MM-dd")
    if (w.type === "alcohol") alcoholByDay[d] = (alcoholByDay[d] ?? 0) + w.amountMl
    else if (w.type === "coffee") coffeeByDay[d] = (coffeeByDay[d] ?? 0) + w.amountMl
    else waterByDay[d] = (waterByDay[d] ?? 0) + w.amountMl
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
    return { r: pearson(pairs), n: pairs.length, sparkPoints: pairs.slice(-20).map(([x, y]) => ({ x, y })) }
  }

  function makeCorr(
    key: string, label: string, emoji: string,
    res: CorrResult,
    insightFn: (r: number) => string,
    isCustom = false,
  ) {
    const { r, n, sparkPoints } = res
    return {
      key, label, emoji, r, n, sparkPoints,
      insight: r != null ? insightFn(r) : `Need at least 5 paired data points (have ${n})`,
      strength: (r == null ? "insufficient" : Math.abs(r) >= 0.5 ? "strong" : Math.abs(r) >= 0.25 ? "moderate" : "weak") as "insufficient" | "strong" | "moderate" | "weak",
      direction: r == null ? null : (r >= 0 ? "positive" : "negative") as "positive" | "negative",
      isCustom,
    }
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

  const lastfmByDay: Record<string, number> = {}
  for (const l of lastfmLogs) lastfmByDay[l.date] = l.listeningMin

  const checkinEnergyByDay: Record<string, number> = {}
  const checkinMoodByDay: Record<string, number> = {}
  for (const c of checkinLogs) {
    checkinEnergyByDay[c.date] = c.energy
    checkinMoodByDay[c.date] = c.mood
  }

  const sleepScoreByDay: Record<string, number> = {}
  const moodByDay: Record<string, number> = {}
  const focusMinByDay: Record<string, number> = {}
  for (const l of allLogs) {
    const d = l.date.toISOString().split("T")[0]
    if (l.sleepScore != null) sleepScoreByDay[d] = l.sleepScore
  }
  for (const m of moodLogs) {
    const d = m.date.toISOString().split("T")[0]
    moodByDay[d] = m.mood
  }
  for (const s of focusSessions) {
    const d = format(new Date(s.endedAt), "yyyy-MM-dd")
    focusMinByDay[d] = (focusMinByDay[d] ?? 0) + s.durationMin
  }

  const spendByDay: Record<string, number> = {}
  for (const t of transactions) {
    const d = format(new Date(t.date), "yyyy-MM-dd")
    spendByDay[d] = (spendByDay[d] ?? 0) + Math.abs(t.amount) / 100
  }

  const lastfmCorrelations: typeof richCorrelations = []

  if (Object.keys(lastfmByDay).length >= 7) {
    const lastfmDefs = [
      {
        key: "lastfm_listen_sleep",
        label: "Listening → Sleep",
        emoji: "🎵",
        xFn: (d: string) => lastfmByDay[d] ?? null,
        yFn: (d: string) => sleepScoreByDay[d] ?? null,
        insightFn: (r: number) => r > 0.2
          ? "More listening time links to better sleep scores"
          : r < -0.2
          ? "Heavy listening days link to lower sleep scores"
          : "Listening time has little effect on your sleep",
      },
      {
        key: "lastfm_listen_mood",
        label: "Listening → Mood",
        emoji: "🎵",
        xFn: (d: string) => lastfmByDay[d] ?? null,
        yFn: (d: string) => moodByDay[d] ?? null,
        insightFn: (r: number) => r > 0.2
          ? "More listening time links to better mood"
          : r < -0.2
          ? "Heavy listening days link to lower mood"
          : "Listening time has little effect on your mood",
      },
      {
        key: "lastfm_listen_focus",
        label: "Listening → Focus",
        emoji: "🎵",
        xFn: (d: string) => lastfmByDay[d] ?? null,
        yFn: (d: string) => focusMinByDay[d] ?? null,
        insightFn: (r: number) => r > 0.2
          ? "More listening time links to longer focus sessions"
          : r < -0.2
          ? "Heavy listening days link to less focus time"
          : "Listening time has little effect on your focus",
      },
    ]

    for (const def of lastfmDefs) {
      const dates = allDateStrs.filter(d => lastfmByDay[d] != null)
      const { r, n } = corr(def.xFn, def.yFn, dates)
      lastfmCorrelations.push({
        key: def.key,
        label: def.label,
        r,
        n,
        emoji: def.emoji,
        insight: r != null ? def.insightFn(r) : `Need at least 5 paired data points (have ${n})`,
        strength: r == null ? "insufficient"
          : Math.abs(r) >= 0.5 ? "strong"
          : Math.abs(r) >= 0.25 ? "moderate"
          : "weak",
        direction: r == null ? null : r >= 0 ? "positive" : "negative",
        isCustom: false,
      })
    }
  }

  const checkinCorrelations: typeof richCorrelations = []

  if (Object.keys(checkinEnergyByDay).length >= 5) {
    const checkinDefs = [
      {
        key: "checkin_energy_sleep",
        label: "Morning energy → Sleep score",
        emoji: "🌅",
        xFn: (d: string) => sleepScoreByDay[d] ?? null,
        yFn: (d: string) => checkinEnergyByDay[d] ?? null,
        insightFn: (r: number) => r > 0.2
          ? "Better sleep predicts higher morning energy"
          : r < -0.2
          ? "Higher sleep scores don't reliably predict morning energy"
          : "Sleep score and morning energy aren't strongly linked yet",
      },
      {
        key: "checkin_energy_steps",
        label: "Morning energy → Steps",
        emoji: "🌅",
        xFn: (d: string) => checkinEnergyByDay[d] ?? null,
        yFn: (d: string) => get(d, "steps"),
        insightFn: (r: number) => r > 0.2
          ? "High-energy mornings lead to more steps during the day"
          : r < -0.2
          ? "Morning energy and steps appear inversely linked"
          : "Morning energy doesn't strongly predict step count yet",
      },
      {
        key: "checkin_mood_focus",
        label: "Morning mood → Focus",
        emoji: "🌅",
        xFn: (d: string) => checkinMoodByDay[d] ?? null,
        yFn: (d: string) => focusMinByDay[d] ?? null,
        insightFn: (r: number) => r > 0.2
          ? "Better morning mood links to longer focus sessions"
          : r < -0.2
          ? "Morning mood and focus time appear inversely linked"
          : "Morning mood doesn't strongly predict focus time yet",
      },
    ]

    for (const def of checkinDefs) {
      const dates = allDateStrs.filter(d => checkinEnergyByDay[d] != null || checkinMoodByDay[d] != null)
      const { r, n } = corr(def.xFn, def.yFn, dates)
      checkinCorrelations.push({
        key: def.key,
        label: def.label,
        r,
        n,
        emoji: def.emoji,
        insight: r != null ? def.insightFn(r) : `Need at least 5 paired data points (have ${n})`,
        strength: r == null ? "insufficient"
          : Math.abs(r) >= 0.5 ? "strong"
          : Math.abs(r) >= 0.25 ? "moderate"
          : "weak",
        direction: r == null ? null : r >= 0 ? "positive" : "negative",
        isCustom: false,
      })
    }
  }

  // ── Intake (alcohol / coffee) correlations ───────────────────────────────────
  const intakeCorrelations: ReturnType<typeof makeCorr>[] = []

  const alcoholDates = allDateStrs.filter(d => alcoholByDay[d] != null)
  if (alcoholDates.length >= 5) {
    for (const def of [
      {
        key: "alcohol_hrv_next", label: "Alcohol → Next-day HRV", emoji: "🍷",
        xFn: (d: string) => alcoholByDay[d] ?? null,
        yFn: (d: string) => get(nextDay(d), "hrv"),
        insightFn: (r: number) => r < -0.25
          ? `Drinking days link to lower HRV the next day (r=${r.toFixed(2)})`
          : r > 0.25 ? "Moderate alcohol doesn't hurt your HRV in this dataset"
          : "Alcohol and next-day HRV aren't strongly linked yet",
      },
      {
        key: "alcohol_sleep", label: "Alcohol → Sleep score", emoji: "🍷",
        xFn: (d: string) => alcoholByDay[d] ?? null,
        yFn: (d: string) => get(d, "sleepScore"),
        insightFn: (r: number) => r < -0.25
          ? `More alcohol links to lower sleep score that night (r=${r.toFixed(2)})`
          : r > 0.25 ? "Alcohol doesn't hurt your sleep score in this dataset"
          : "Alcohol and sleep score aren't strongly linked yet",
      },
      {
        key: "alcohol_readiness_next", label: "Alcohol → Next-day readiness", emoji: "🍷",
        xFn: (d: string) => alcoholByDay[d] ?? null,
        yFn: (d: string) => get(nextDay(d), "readinessScore"),
        insightFn: (r: number) => r < -0.25
          ? `Drinking days predict lower readiness the next day (r=${r.toFixed(2)})`
          : r > 0.25 ? "Alcohol doesn't reduce next-day readiness in your data"
          : "Alcohol and next-day readiness aren't strongly linked yet",
      },
    ]) {
      intakeCorrelations.push(makeCorr(def.key, def.label, def.emoji, corr(def.xFn, def.yFn, alcoholDates), def.insightFn))
    }
  }

  const coffeeDates = allDateStrs.filter(d => coffeeByDay[d] != null)
  if (coffeeDates.length >= 5) {
    for (const def of [
      {
        key: "coffee_sleep", label: "Coffee → Sleep score", emoji: "☕",
        xFn: (d: string) => coffeeByDay[d] ?? null,
        yFn: (d: string) => get(d, "sleepScore"),
        insightFn: (r: number) => r < -0.25
          ? `More coffee links to lower sleep score (r=${r.toFixed(2)})`
          : r > 0.25 ? "Coffee doesn't hurt your sleep in this dataset"
          : "Coffee and sleep score aren't strongly linked yet",
      },
      {
        key: "coffee_hrv_next", label: "Coffee → Next-day HRV", emoji: "☕",
        xFn: (d: string) => coffeeByDay[d] ?? null,
        yFn: (d: string) => get(nextDay(d), "hrv"),
        insightFn: (r: number) => r < -0.25
          ? `High coffee days link to lower HRV the next day (r=${r.toFixed(2)})`
          : r > 0.25 ? "Coffee doesn't seem to affect your HRV negatively"
          : "Coffee and next-day HRV aren't strongly linked yet",
      },
    ]) {
      intakeCorrelations.push(makeCorr(def.key, def.label, def.emoji, corr(def.xFn, def.yFn, coffeeDates), def.insightFn))
    }
  }

  // ── Spending correlations ────────────────────────────────────────────────────
  const spendingCorrelations: ReturnType<typeof makeCorr>[] = []

  const spendDates = allDateStrs.filter(d => spendByDay[d] != null)
  if (spendDates.length >= 5) {
    for (const def of [
      {
        key: "spend_mood", label: "Spending → Mood", emoji: "💸",
        xFn: (d: string) => spendByDay[d] ?? null,
        yFn: getMood,
        insightFn: (r: number) => r > 0.25
          ? `Higher spending days link to better mood (r=${r.toFixed(2)})`
          : r < -0.25 ? `Higher spending days link to lower mood (r=${r.toFixed(2)})`
          : "Spending and same-day mood aren't strongly linked yet",
      },
      {
        key: "spend_mood_next", label: "Spending → Next-day mood", emoji: "💸",
        xFn: (d: string) => spendByDay[d] ?? null,
        yFn: (d: string) => getMood(nextDay(d)),
        insightFn: (r: number) => r > 0.25
          ? "Spending days link to better mood the next day"
          : r < -0.25 ? "Spending days link to lower mood the next day"
          : "Spending and next-day mood aren't strongly linked yet",
      },
      {
        key: "spend_focus", label: "Spending → Focus time", emoji: "💸",
        xFn: (d: string) => spendByDay[d] ?? null,
        yFn: (d: string) => focusMinByDay[d] ?? null,
        insightFn: (r: number) => r > 0.25
          ? "Higher spending days link to longer focus sessions"
          : r < -0.25 ? "Higher spending days link to less focus time"
          : "Spending and focus time aren't strongly linked yet",
      },
    ]) {
      spendingCorrelations.push(makeCorr(def.key, def.label, def.emoji, corr(def.xFn, def.yFn, spendDates), def.insightFn))
    }
  }

  // ── Weather correlations ─────────────────────────────────────────────────────
  const weatherByDay: Record<string, { tempMaxC: number | null; precipMm: number | null; uvIndex: number | null }> = {}
  for (const w of weatherLogs) {
    weatherByDay[w.date] = { tempMaxC: w.tempMaxC, precipMm: w.precipMm, uvIndex: w.uvIndex }
  }

  const weatherCorrelations: typeof richCorrelations = []

  if (Object.keys(weatherByDay).length >= 7) {
    const weatherDates = allDateStrs.filter(d => weatherByDay[d] != null)

    const weatherCorrDefs = [
      {
        key: "weather_temp_sleep",
        label: "Temperature → Sleep",
        emoji: "🌡️",
        xFn: (d: string) => weatherByDay[d]?.tempMaxC ?? null,
        yFn: (d: string) => get(d, "sleepScore"),
        insightFn: (r: number) => r > 0.2
          ? "Warmer days link to better sleep"
          : r < -0.2
          ? "Cooler days link to better sleep"
          : "Temperature has little effect on your sleep",
      },
      {
        key: "weather_temp_steps",
        label: "Temperature → Steps",
        emoji: "🌡️",
        xFn: (d: string) => weatherByDay[d]?.tempMaxC ?? null,
        yFn: (d: string) => get(d, "steps"),
        insightFn: (r: number) => r > 0.2
          ? "Warmer days link to more steps"
          : r < -0.2
          ? "Cooler days link to more steps"
          : "Temperature has little effect on your step count",
      },
      {
        key: "weather_rain_mood",
        label: "Rain → Mood",
        emoji: "🌧️",
        xFn: (d: string) => weatherByDay[d]?.precipMm ?? null,
        yFn: (d: string) => getMood(d),
        insightFn: (r: number) => r > 0.2
          ? "Rainier days link to better mood"
          : r < -0.2
          ? "Rainy days link to lower mood"
          : "Rainfall has little effect on your mood",
      },
      {
        key: "weather_uv_readiness",
        label: "UV Index → Readiness",
        emoji: "☀️",
        xFn: (d: string) => weatherByDay[d]?.uvIndex ?? null,
        yFn: (d: string) => get(d, "readinessScore"),
        insightFn: (r: number) => r > 0.2
          ? "Sunnier days link to better readiness"
          : r < -0.2
          ? "Higher UV days link to lower readiness"
          : "UV index has little effect on your readiness",
      },
    ]

    for (const def of weatherCorrDefs) {
      const { r, n } = corr(def.xFn, def.yFn, weatherDates)
      weatherCorrelations.push({
        key: def.key,
        label: def.label,
        r,
        n,
        emoji: def.emoji,
        insight: r != null ? def.insightFn(r) : `Need at least 5 paired data points (have ${n})`,
        strength: r == null ? "insufficient"
          : Math.abs(r) >= 0.5 ? "strong"
          : Math.abs(r) >= 0.25 ? "moderate"
          : "weak",
        direction: r == null ? null : r >= 0 ? "positive" : "negative",
        isCustom: false,
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
    intakeCorrelations,
    spendingCorrelations,
    weatherCorrelations,
    lastfmCorrelations,
    checkinCorrelations,
    dataPoints: allDateStrs.length,
  })
}
