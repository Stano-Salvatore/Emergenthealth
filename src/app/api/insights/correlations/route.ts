import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { subDays, format } from "date-fns"

// ─── Types ────────────────────────────────────────────────────────────────────

type DayData = {
  date: string
  sleepScore?: number
  sleepDuration?: number // hours
  readiness?: number
  stressHighMin?: number
  hrv?: number
  steps?: number
  activityScore?: number
  energy?: number
  mood?: number
  habitCount?: number
  caffeineMg?: number
  tags?: string[]
}

export type InsightResult = {
  id: string
  category: "sleep" | "stress" | "habits" | "caffeine" | "tags"
  emoji: string
  title: string
  finding: string
  delta: number
  highGroupLabel: string
  lowGroupLabel: string
  highGroupAvg: number
  lowGroupAvg: number
  highGroupN: number
  lowGroupN: number
  confident: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function r1(n: number): number {
  return Math.round(n * 10) / 10
}

function nextDateStr(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z")
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Compare two groups on a metric. Returns an insight if both groups have >= minN days.
 */
function compareGroups(opts: {
  id: string
  category: InsightResult["category"]
  emoji: string
  title: string
  highGroupLabel: string
  lowGroupLabel: string
  highValues: number[]
  lowValues: number[]
  // positive delta = beneficial (high group is better)
  higherIsBetter?: boolean
  findingTemplate: (highAvg: number, lowAvg: number) => string
  minN?: number
}): InsightResult | null {
  const {
    id, category, emoji, title,
    highGroupLabel, lowGroupLabel,
    highValues, lowValues,
    higherIsBetter = true,
    findingTemplate,
    minN = 5,
  } = opts

  if (highValues.length < minN || lowValues.length < minN) return null

  const highAvg = r1(avg(highValues))
  const lowAvg = r1(avg(lowValues))

  if (lowAvg === 0) return null

  const rawDelta = ((highAvg - lowAvg) / Math.abs(lowAvg)) * 100
  // If higher is NOT better, flip delta so positive = beneficial
  const delta = higherIsBetter ? rawDelta : -rawDelta

  return {
    id,
    category,
    emoji,
    title,
    finding: findingTemplate(highAvg, lowAvg),
    delta: Math.round(delta * 10) / 10,
    highGroupLabel,
    lowGroupLabel,
    highGroupAvg: highAvg,
    lowGroupAvg: lowAvg,
    highGroupN: highValues.length,
    lowGroupN: lowValues.length,
    confident: highValues.length >= 10 && lowValues.length >= 10,
  }
}

// ─── Route ────────────────────────────────────────────────────────────────────

const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, overall: 90 }

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const url = new URL(req.url)
  const period = url.searchParams.get("period") ?? "overall"
  const windowDays = PERIOD_DAYS[period] ?? 90

  const since60 = subDays(new Date(), windowDays - 1)
  const since60str = format(since60, "yyyy-MM-dd")

  // ── Fetch all data sources in parallel ──────────────────────────────────────
  const [healthLogs, checkIns, habitCompletions, caffeineRows, tagPrefs] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since60 } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        sleepScore: true,
        sleepDuration: true,
        readinessScore: true,
        stressHigh: true,
        hrv: true,
        steps: true,
        activityScore: true,
      },
    }),

    prisma.$queryRaw<{ date: string; energy: number; mood: number }[]>`
      SELECT "date", "energy", "mood"
      FROM "MorningCheckIn"
      WHERE "userId" = ${userId}
        AND "date" >= ${since60str}
    `.catch(() => [] as { date: string; energy: number; mood: number }[]),

    prisma.habitCompletion.findMany({
      where: { userId, date: { gte: since60 } },
      select: { date: true },
    }).catch(() => [] as { date: Date }[]),

    prisma.$queryRaw<{ date: string; totalMg: number }[]>`
      SELECT
        DATE("loggedAt" AT TIME ZONE 'UTC')::text AS date,
        SUM("caffeineMg") AS "totalMg"
      FROM "CaffeineLog"
      WHERE "userId" = ${userId}
        AND "loggedAt" >= ${since60}
      GROUP BY DATE("loggedAt" AT TIME ZONE 'UTC')
    `.catch(() => [] as { date: string; totalMg: number }[]),

    prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value"
      FROM "UserPreference"
      WHERE "userId" = ${userId}
        AND "key" LIKE 'daily_tags:%'
    `.catch(() => [] as { key: string; value: string }[]),
  ])

  // ── Build day map ────────────────────────────────────────────────────────────
  const dayMap = new Map<string, DayData>()

  function getOrCreate(dateStr: string): DayData {
    if (!dayMap.has(dateStr)) dayMap.set(dateStr, { date: dateStr })
    return dayMap.get(dateStr)!
  }

  for (const l of healthLogs) {
    const dateStr = l.date.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    if (l.sleepScore != null) d.sleepScore = l.sleepScore
    if (l.sleepDuration != null) d.sleepDuration = l.sleepDuration / 60 // convert minutes → hours
    if (l.readinessScore != null) d.readiness = l.readinessScore
    if (l.stressHigh != null) d.stressHighMin = l.stressHigh
    if (l.hrv != null) d.hrv = l.hrv
    if (l.steps != null) d.steps = l.steps
    if (l.activityScore != null) d.activityScore = l.activityScore
  }

  for (const c of checkIns) {
    const d = getOrCreate(c.date)
    d.energy = c.energy
    d.mood = c.mood
  }

  // Count habit completions per day
  const habitCountByDay: Record<string, number> = {}
  for (const hc of habitCompletions) {
    const dateStr = hc.date instanceof Date ? hc.date.toISOString().slice(0, 10) : String(hc.date).slice(0, 10)
    habitCountByDay[dateStr] = (habitCountByDay[dateStr] ?? 0) + 1
  }
  for (const [dateStr, count] of Object.entries(habitCountByDay)) {
    getOrCreate(dateStr).habitCount = count
  }

  for (const row of caffeineRows) {
    const d = getOrCreate(row.date)
    d.caffeineMg = Number(row.totalMg)
  }

  // Parse tag preferences: key = "daily_tags:YYYY-MM-DD"
  for (const pref of tagPrefs) {
    const dateStr = pref.key.slice("daily_tags:".length)
    if (dateStr < since60str) continue
    try {
      const tags = JSON.parse(pref.value)
      if (Array.isArray(tags) && tags.length > 0) {
        getOrCreate(dateStr).tags = tags as string[]
      }
    } catch {
      // malformed JSON — skip
    }
  }

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totalDays = days.length

  // ── Compute insights ─────────────────────────────────────────────────────────
  const insights: InsightResult[] = []

  // Helper: get day data by date string
  const byDate = Object.fromEntries(days.map(d => [d.date, d]))

  // 1. Sleep duration → next-day energy
  const sleepDurHighEnergy: number[] = []
  const sleepDurLowEnergy: number[] = []
  const sleepDurHighMood: number[] = []
  const sleepDurLowMood: number[] = []

  for (const d of days) {
    if (d.sleepDuration == null) continue
    const next = byDate[nextDateStr(d.date)]
    if (!next) continue
    const isHigh = d.sleepDuration >= 7
    if (next.energy != null) {
      if (isHigh) sleepDurHighEnergy.push(next.energy)
      else sleepDurLowEnergy.push(next.energy)
    }
    if (next.mood != null) {
      if (isHigh) sleepDurHighMood.push(next.mood)
      else sleepDurLowMood.push(next.mood)
    }
  }

  const ins_sleepDur_energy = compareGroups({
    id: "sleep_duration_energy",
    category: "sleep",
    emoji: "🌙",
    title: "Sleep Duration & Morning Energy",
    highGroupLabel: "7h+ sleep nights",
    lowGroupLabel: "under 7h sleep nights",
    highValues: sleepDurHighEnergy,
    lowValues: sleepDurLowEnergy,
    findingTemplate: (h, l) => `After 7h+ sleep, your morning energy averages ${h} vs ${l} on shorter nights`,
  })
  if (ins_sleepDur_energy) insights.push(ins_sleepDur_energy)

  const ins_sleepDur_mood = compareGroups({
    id: "sleep_duration_mood",
    category: "sleep",
    emoji: "😊",
    title: "Sleep Duration & Morning Mood",
    highGroupLabel: "7h+ sleep nights",
    lowGroupLabel: "under 7h sleep nights",
    highValues: sleepDurHighMood,
    lowValues: sleepDurLowMood,
    findingTemplate: (h, l) => `After 7h+ sleep, your morning mood averages ${h} vs ${l} after shorter nights`,
  })
  if (ins_sleepDur_mood) insights.push(ins_sleepDur_mood)

  // 2. Sleep score → next-day energy & mood
  const sleepScoreHighEnergy: number[] = []
  const sleepScoreLowEnergy: number[] = []
  const sleepScoreHighMood: number[] = []
  const sleepScoreLowMood: number[] = []

  for (const d of days) {
    if (d.sleepScore == null) continue
    const next = byDate[nextDateStr(d.date)]
    if (!next) continue
    const isHigh = d.sleepScore >= 80
    if (next.energy != null) {
      if (isHigh) sleepScoreHighEnergy.push(next.energy)
      else sleepScoreLowEnergy.push(next.energy)
    }
    if (next.mood != null) {
      if (isHigh) sleepScoreHighMood.push(next.mood)
      else sleepScoreLowMood.push(next.mood)
    }
  }

  const ins_sleepScore_energy = compareGroups({
    id: "sleep_score_energy",
    category: "sleep",
    emoji: "⚡",
    title: "Sleep Score & Morning Energy",
    highGroupLabel: "80+ sleep score nights",
    lowGroupLabel: "below 80 sleep score nights",
    highValues: sleepScoreHighEnergy,
    lowValues: sleepScoreLowEnergy,
    findingTemplate: (h, l) => `On high sleep score nights (80+), next-day energy averages ${h} vs ${l}`,
  })
  if (ins_sleepScore_energy) insights.push(ins_sleepScore_energy)

  const ins_sleepScore_mood = compareGroups({
    id: "sleep_score_mood",
    category: "sleep",
    emoji: "🌟",
    title: "Sleep Score & Morning Mood",
    highGroupLabel: "80+ sleep score nights",
    lowGroupLabel: "below 80 sleep score nights",
    highValues: sleepScoreHighMood,
    lowValues: sleepScoreLowMood,
    findingTemplate: (h, l) => `On high sleep score nights (80+), next-day mood averages ${h} vs ${l}`,
  })
  if (ins_sleepScore_mood) insights.push(ins_sleepScore_mood)

  // 3. Stress (high stress minutes) → same-night sleep score & next-day mood
  const stressHighSleep: number[] = []
  const stressLowSleep: number[] = []
  const stressHighMood: number[] = []
  const stressLowMood: number[] = []

  for (const d of days) {
    if (d.stressHighMin == null) continue
    const isHigh = d.stressHighMin >= 60
    if (d.sleepScore != null) {
      if (isHigh) stressHighSleep.push(d.sleepScore)
      else stressLowSleep.push(d.sleepScore)
    }
    const next = byDate[nextDateStr(d.date)]
    if (next?.mood != null) {
      if (isHigh) stressHighMood.push(next.mood)
      else stressLowMood.push(next.mood)
    }
  }

  const ins_stress_sleep = compareGroups({
    id: "stress_sleep",
    category: "stress",
    emoji: "😤",
    title: "High Stress & Sleep Quality",
    highGroupLabel: "60+ min high stress days",
    lowGroupLabel: "low stress days",
    highValues: stressHighSleep,
    lowValues: stressLowSleep,
    // higher stress → lower sleep is the "bad" direction; lower sleep = bad so higherIsBetter=true but groups reversed
    higherIsBetter: true,
    findingTemplate: (h, l) => `On high-stress days (60+ min), your sleep score averages ${h} vs ${l} on calmer days`,
  })
  if (ins_stress_sleep) insights.push(ins_stress_sleep)

  const ins_stress_mood = compareGroups({
    id: "stress_mood",
    category: "stress",
    emoji: "🧘",
    title: "High Stress & Next-Day Mood",
    highGroupLabel: "60+ min high stress days",
    lowGroupLabel: "low stress days",
    highValues: stressHighMood,
    lowValues: stressLowMood,
    higherIsBetter: true,
    findingTemplate: (h, l) => `After high-stress days (60+ min), next-day mood averages ${h} vs ${l} after calm days`,
  })
  if (ins_stress_mood) insights.push(ins_stress_mood)

  // 4. Habit count → same-day mood & energy
  const habitCounts = days.filter(d => d.habitCount != null).map(d => d.habitCount!)
  const habitMedian = habitCounts.length >= 3 ? median(habitCounts) : 3
  const habitThreshold = Math.max(3, habitMedian)

  const habitHighMood: number[] = []
  const habitLowMood: number[] = []
  const habitHighEnergy: number[] = []
  const habitLowEnergy: number[] = []

  for (const d of days) {
    if (d.habitCount == null) continue
    const isHigh = d.habitCount >= habitThreshold
    if (d.mood != null) {
      if (isHigh) habitHighMood.push(d.mood)
      else habitLowMood.push(d.mood)
    }
    if (d.energy != null) {
      if (isHigh) habitHighEnergy.push(d.energy)
      else habitLowEnergy.push(d.energy)
    }
  }

  const habitLabel = `${habitThreshold}+ habits completed`

  const ins_habit_mood = compareGroups({
    id: "habits_mood",
    category: "habits",
    emoji: "✅",
    title: "Habit Completion & Mood",
    highGroupLabel: habitLabel,
    lowGroupLabel: `fewer than ${habitThreshold} habits`,
    highValues: habitHighMood,
    lowValues: habitLowMood,
    findingTemplate: (h, l) => `On days you complete ${habitThreshold}+ habits, mood averages ${h} vs ${l} on lower-completion days`,
  })
  if (ins_habit_mood) insights.push(ins_habit_mood)

  const ins_habit_energy = compareGroups({
    id: "habits_energy",
    category: "habits",
    emoji: "🎯",
    title: "Habit Completion & Energy",
    highGroupLabel: habitLabel,
    lowGroupLabel: `fewer than ${habitThreshold} habits`,
    highValues: habitHighEnergy,
    lowValues: habitLowEnergy,
    findingTemplate: (h, l) => `On days you complete ${habitThreshold}+ habits, morning energy averages ${h} vs ${l}`,
  })
  if (ins_habit_energy) insights.push(ins_habit_energy)

  // 5. Caffeine → same-night sleep score
  const caffeineHighSleep: number[] = []
  const caffeineLowSleep: number[] = []

  for (const d of days) {
    if (d.caffeineMg == null || d.sleepScore == null) continue
    const isHigh = d.caffeineMg >= 200
    if (isHigh) caffeineHighSleep.push(d.sleepScore)
    else caffeineLowSleep.push(d.sleepScore)
  }

  const ins_caffeine_sleep = compareGroups({
    id: "caffeine_sleep",
    category: "caffeine",
    emoji: "☕",
    title: "Caffeine Intake & Sleep Quality",
    highGroupLabel: "200mg+ caffeine days",
    lowGroupLabel: "under 200mg caffeine days",
    highValues: caffeineHighSleep,
    lowValues: caffeineLowSleep,
    findingTemplate: (h, l) =>
      h < l
        ? `High caffeine days (200mg+) link to a sleep score of ${h} vs ${l} on lower-caffeine days`
        : `Interestingly, high caffeine days (200mg+) don't hurt your sleep — avg score ${h} vs ${l}`,
  })
  if (ins_caffeine_sleep) insights.push(ins_caffeine_sleep)

  // 6. Tag insights — top 5 most common tags
  const tagCounts: Record<string, number> = {}
  for (const d of days) {
    for (const tag of d.tags ?? []) {
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
    }
  }
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag)

  for (const tag of topTags) {
    const tagMoodHigh: number[] = []
    const tagMoodLow: number[] = []
    const tagEnergyHigh: number[] = []
    const tagEnergyLow: number[] = []

    for (const d of days) {
      const hasTag = (d.tags ?? []).includes(tag)
      if (d.mood != null) {
        if (hasTag) tagMoodHigh.push(d.mood)
        else tagMoodLow.push(d.mood)
      }
      if (d.energy != null) {
        if (hasTag) tagEnergyHigh.push(d.energy)
        else tagEnergyLow.push(d.energy)
      }
    }

    const safeTag = tag.toLowerCase().replace(/[^a-z0-9]/g, "_")

    const ins_tag_mood = compareGroups({
      id: `tag_${safeTag}_mood`,
      category: "tags",
      emoji: "🏷️",
      title: `"${tag}" Days & Mood`,
      highGroupLabel: `${tag} days`,
      lowGroupLabel: `non-${tag} days`,
      highValues: tagMoodHigh,
      lowValues: tagMoodLow,
      findingTemplate: (h, l) => `On "${tag}" days, mood averages ${h} vs ${l} on other days`,
    })
    if (ins_tag_mood) insights.push(ins_tag_mood)

    const ins_tag_energy = compareGroups({
      id: `tag_${safeTag}_energy`,
      category: "tags",
      emoji: "⚡",
      title: `"${tag}" Days & Energy`,
      highGroupLabel: `${tag} days`,
      lowGroupLabel: `non-${tag} days`,
      highValues: tagEnergyHigh,
      lowValues: tagEnergyLow,
      findingTemplate: (h, l) => `On "${tag}" days, morning energy averages ${h} vs ${l} on other days`,
    })
    if (ins_tag_energy) insights.push(ins_tag_energy)
  }

  // ── Sort by |delta| desc ─────────────────────────────────────────────────────
  insights.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))

  return NextResponse.json({
    insights,
    dataRange: { days: totalDays },
  })
}
