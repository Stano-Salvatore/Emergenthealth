import { prisma } from "@/lib/prisma"
import { subDays, format } from "date-fns"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { normalizeSupplement } from "@/lib/supplement-normalize"

// Shared correlation engine, used by both the /api/insights/correlations route
// (interactive dashboard) and the correlation-watch cron (pin & watch alerts).

type DayData = {
  date: string
  sleepScore?: number
  sleepDuration?: number // hours
  readiness?: number
  restingHR?: number
  stressHighMin?: number
  hrv?: number
  steps?: number
  activityScore?: number
  screenTimeMin?: number
  firstUnlockMin?: number
  energy?: number
  mood?: number
  habitCount?: number
  caffeineMg?: number
  alcoholMl?: number
  tags?: string[]
  precipMm?: number
  tempMaxC?: number
  weatherCode?: number
  eventCount?: number      // calendar events on this day
  eventTitles?: string[]   // their titles (for per-activity discovery)
  waterMl?: number         // water + sparkling logged
  calories?: number        // meals logged on the Food tab
  proteinG?: number
  sugarG?: number
  lastMealMin?: number     // minutes after local midnight of the day's last meal
  supplements?: string[]   // normalized supplement names taken (Oura tags)
  deepSleepMin?: number    // sleep architecture (Oura)
  remSleepMin?: number
  workoutMin?: number      // Strava moving time that day
  focusMin?: number        // completed focus-session minutes
  listeningMin?: number    // Last.fm music listening
  spendEur?: number        // card spending (outgoing, transfers excluded)
  uvIndex?: number
  fastH?: number           // longest completed fast ending this day
}

export type InsightResult = {
  id: string
  category: "sleep" | "stress" | "habits" | "caffeine" | "recovery" | "screen" | "tags" | "calendar" | "food" | "supplements" | "fitness" | "music" | "money" | "focus" | "fasting"
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
  /** Permutation-test p-value: how often random group shuffles produce a difference this large. */
  pValue: number
  /**
   * Trust tier after Benjamini-Hochberg false-discovery control across the
   * whole run: "strong" survives FDR at q=0.10, "suggestive" has raw p ≤ 0.10,
   * "noise" is indistinguishable from chance. With ~70 candidate insights,
   * several will always look interesting by luck — this is what separates them.
   */
  tier: "strong" | "suggestive" | "noise"
  /** True when the effect collapses or flips once weekends are excluded — the classic confounder. */
  weekendDriven?: boolean
}

export const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, overall: 90 }

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

// Deterministic RNG (mulberry32) so permutation p-values are reproducible in
// tests and stable across the two engine passes (all days / weekdays only).
function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a += 0x6d2b79f5
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const PERMUTATIONS = 1000

/**
 * Permutation test: shuffle the values between the two groups PERMUTATIONS
 * times and count how often chance alone produces a mean difference at least
 * as large as the observed one. Distribution-free — no normality assumptions,
 * works at the small n this engine deals in.
 */
function permutationP(high: number[], low: number[], seedKey: string): number {
  const observed = Math.abs(avg(high) - avg(low))
  const pool = [...high, ...low]
  const nHigh = high.length
  const rng = seededRng(hashString(seedKey))
  let atLeast = 0
  for (let p = 0; p < PERMUTATIONS; p++) {
    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    let sumHigh = 0
    for (let i = 0; i < nHigh; i++) sumHigh += pool[i]
    let sumLow = 0
    for (let i = nHigh; i < pool.length; i++) sumLow += pool[i]
    const diff = Math.abs(sumHigh / nHigh - sumLow / (pool.length - nHigh))
    if (diff >= observed - 1e-12) atLeast++
  }
  // +1 correction: a permutation p-value is never exactly 0
  return (atLeast + 1) / (PERMUTATIONS + 1)
}

/**
 * Benjamini-Hochberg false-discovery control at q=0.10 over a whole run's
 * insights, assigning each its trust tier in place.
 */
export function assignTiers(insights: InsightResult[]): void {
  const sorted = [...insights].sort((a, b) => a.pValue - b.pValue)
  const m = sorted.length
  let cutoffIdx = -1
  for (let i = 0; i < m; i++) {
    if (sorted[i].pValue <= ((i + 1) / m) * 0.10) cutoffIdx = i
  }
  sorted.forEach((ins, idx) => {
    ins.tier = idx <= cutoffIdx ? "strong" : ins.pValue <= 0.10 ? "suggestive" : "noise"
  })
}

function isWeekendDate(dateStr: string): boolean {
  const dow = new Date(dateStr + "T12:00:00Z").getUTCDay()
  return dow === 0 || dow === 6
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
    pValue: permutationP(highValues, lowValues, id),
    tier: "noise", // provisional — assignTiers() sets the real tier per run
  }
}

/**
 * Compute all correlation insights for a user over the last `windowDays` days,
 * sorted by absolute effect size (strongest first).
 */
export async function computeCorrelations(
  userId: string,
  windowDays: number,
): Promise<{ insights: InsightResult[]; totalDays: number }> {
  const since60 = subDays(new Date(), windowDays - 1)
  const since60str = format(since60, "yyyy-MM-dd")

  const [healthLogs, checkIns, habitCompletions, caffeineRows, alcoholRows, tagPrefs, weatherLogs, screenRows, deviceEvents] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: since60 } },
      orderBy: { date: "asc" },
      select: {
        date: true,
        sleepScore: true,
        sleepDuration: true,
        readinessScore: true,
        restingHR: true,
        stressHigh: true,
        hrv: true,
        steps: true,
        activityScore: true,
        deepSleep: true,
        remSleep: true,
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

    prisma.$queryRaw<{ date: string; totalMl: number }[]>`
      SELECT
        DATE("loggedAt" AT TIME ZONE 'UTC')::text AS date,
        SUM("amountMl") AS "totalMl"
      FROM "IntakeLog"
      WHERE "userId" = ${userId}
        AND "type" = 'alcohol'
        AND "loggedAt" >= ${since60}
      GROUP BY DATE("loggedAt" AT TIME ZONE 'UTC')
    `.catch(() => [] as { date: string; totalMl: number }[]),

    prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value"
      FROM "UserPreference"
      WHERE "userId" = ${userId}
        AND "key" LIKE 'daily_tags:%'
    `.catch(() => [] as { key: string; value: string }[]),

    prisma.weatherLog.findMany({
      where: { userId, date: { gte: since60str } },
      select: { date: true, precipMm: true, tempMaxC: true, weatherCode: true, uvIndex: true },
    }).catch(() => [] as { date: string; precipMm: number | null; tempMaxC: number | null; weatherCode: number | null; uvIndex: number | null }[]),

    prisma.screenTimeLog.findMany({
      where: { userId, date: { gte: since60str } },
      select: { date: true, totalMin: true, firstUnlockMin: true },
    }).catch(() => [] as { date: string; totalMin: number; firstUnlockMin: number | null }[]),

    // Past calendar events in the window — for calendar-load + per-activity
    // correlations. Capped at midnight today so future events don't count.
    prisma.deviceCalendarEvent.findMany({
      where: { userId, start: { gte: since60, lte: new Date() } },
      select: { title: true, start: true },
    }).catch(() => [] as { title: string; start: Date }[]),
  ])

  const [waterRows, foodRows, ouraTagRows, tzRow] = await Promise.all([
    prisma.intakeLog.findMany({
      where: { userId, type: { in: ["water", "sparkling"] }, loggedAt: { gte: since60 } },
      select: { loggedAt: true, amountMl: true },
    }).catch(() => [] as { loggedAt: Date; amountMl: number }[]),

    prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: since60 } },
      select: { loggedAt: true, calories: true, proteinG: true, sugarG: true },
    }).catch(() => [] as { loggedAt: Date; calories: number; proteinG: number | null; sugarG: number | null }[]),

    // Supplements the user logs in the Oura app (drinks are mirrored into
    // IntakeLog by the sync; med-kind tags are the supplement signal)
    prisma.ouraTag.findMany({
      where: { userId, day: { gte: since60str } },
      select: { day: true, tagName: true, text: true },
    }).catch(() => [] as { day: string; tagName: string | null; text: string | null }[]),

    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "timezone" } },
    }).catch(() => null),
  ])

  // Sources that used to live only in the /api/stats mini-engine (music, money,
  // focus) or nowhere at all (standalone mood logs, Strava, fasting).
  const [moodRows, stravaRows, focusRows, lastfmRows, txRows, fastPref] = await Promise.all([
    prisma.moodLog.findMany({
      where: { userId, date: { gte: since60 } },
      select: { date: true, mood: true },
    }).catch(() => [] as { date: Date; mood: number }[]),

    prisma.stravaActivity.findMany({
      where: { userId, day: { gte: since60str } },
      select: { day: true, movingTimeSec: true },
    }).catch(() => [] as { day: string; movingTimeSec: number }[]),

    prisma.focusSession.findMany({
      where: { userId, type: "focus", endedAt: { gte: since60 } },
      select: { endedAt: true, durationMin: true },
    }).catch(() => [] as { endedAt: Date; durationMin: number }[]),

    // Last.fm lives in a raw-DDL table with no Prisma model
    prisma.$queryRaw<{ date: string; listeningMin: number }[]>`
      SELECT "date", "listeningMin" FROM "LastfmLog"
      WHERE "userId" = ${userId} AND "date" >= ${since60str}
    `.catch(() => [] as { date: string; listeningMin: number }[]),

    prisma.transaction.findMany({
      where: { userId, date: { gte: since60 }, isTransfer: false, amount: { lt: 0 } },
      select: { date: true, amount: true },
    }).catch(() => [] as { date: Date; amount: number }[]),

    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "fast:history" } },
    }).catch(() => null),
  ])

  const dayMap = new Map<string, DayData>()

  function getOrCreate(dateStr: string): DayData {
    if (!dayMap.has(dateStr)) dayMap.set(dateStr, { date: dateStr })
    return dayMap.get(dateStr)!
  }

  for (const l of healthLogs) {
    const dateStr = l.date.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    if (l.sleepScore != null) d.sleepScore = l.sleepScore
    if (l.sleepDuration != null) d.sleepDuration = l.sleepDuration / 60
    if (l.readinessScore != null) d.readiness = l.readinessScore
    if (l.restingHR != null) d.restingHR = l.restingHR
    if (l.stressHigh != null) d.stressHighMin = l.stressHigh
    if (l.hrv != null) d.hrv = l.hrv
    if (l.steps != null) d.steps = l.steps
    if (l.activityScore != null) d.activityScore = l.activityScore
    if (l.deepSleep != null) d.deepSleepMin = l.deepSleep
    if (l.remSleep != null) d.remSleepMin = l.remSleep
  }

  for (const c of checkIns) {
    const d = getOrCreate(c.date)
    d.energy = c.energy
    d.mood = c.mood
  }

  // Standalone mood logs (the mood button, Emergy's log_mood tool). The engine
  // only ever read morning-checkin mood, so these moods correlated with
  // nothing. Check-in mood wins when both exist on a day.
  for (const m of moodRows) {
    const dateStr = m.date.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    if (d.mood == null) d.mood = m.mood
  }

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

  for (const row of alcoholRows) {
    const d = getOrCreate(row.date)
    d.alcoholMl = Number(row.totalMl)
  }

  for (const w of weatherLogs) {
    const d = getOrCreate(w.date)
    if (w.precipMm != null) d.precipMm = w.precipMm
    if (w.tempMaxC != null) d.tempMaxC = w.tempMaxC
    if (w.weatherCode != null) d.weatherCode = w.weatherCode
    if (w.uvIndex != null) d.uvIndex = w.uvIndex
  }

  for (const s of (screenRows as { date: string; totalMin: number; firstUnlockMin: number | null }[])) {
    if (s.totalMin != null) getOrCreate(s.date).screenTimeMin = s.totalMin
    if (s.firstUnlockMin != null) getOrCreate(s.date).firstUnlockMin = s.firstUnlockMin
  }

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

  for (const ev of (deviceEvents as { title: string; start: Date }[])) {
    const dateStr = ev.start.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    d.eventCount = (d.eventCount ?? 0) + 1
    ;(d.eventTitles ??= []).push((ev.title ?? "").trim())
  }

  for (const w of waterRows) {
    const dateStr = w.loggedAt.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    d.waterMl = (d.waterMl ?? 0) + w.amountMl
  }

  // Food-tab meals: day totals, plus the local clock time of the day's last
  // meal (meal *timing* is a sleep lever the timestamps give us for free)
  const tz = tzRow?.value || "UTC"
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
  const localMinutes = (date: Date): number => {
    const [h, m] = timeFmt.format(date).split(":").map(Number)
    return (h % 24) * 60 + m
  }
  for (const f of foodRows) {
    const dateStr = f.loggedAt.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    d.calories = (d.calories ?? 0) + f.calories
    if (f.proteinG != null) d.proteinG = (d.proteinG ?? 0) + f.proteinG
    if (f.sugarG != null) d.sugarG = (d.sugarG ?? 0) + f.sugarG
    const min = localMinutes(f.loggedAt)
    if (d.lastMealMin == null || min > d.lastMealMin) d.lastMealMin = min
  }

  for (const t of ouraTagRows) {
    const label = ((t.tagName ?? t.text) ?? "").trim()
    if (!label || classifyOuraTag(label).kind !== "med") continue
    const name = normalizeSupplement(label) ?? label
    const d = getOrCreate(t.day)
    d.supplements ??= []
    if (!d.supplements.includes(name)) d.supplements.push(name)
  }

  for (const a of stravaRows) {
    const d = getOrCreate(a.day)
    d.workoutMin = (d.workoutMin ?? 0) + Math.round(a.movingTimeSec / 60)
  }

  for (const f of focusRows) {
    const dateStr = f.endedAt.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    d.focusMin = (d.focusMin ?? 0) + f.durationMin
  }

  for (const l of lastfmRows) {
    if (l.listeningMin != null) getOrCreate(l.date).listeningMin = Number(l.listeningMin)
  }

  for (const t of txRows) {
    const dateStr = t.date.toISOString().slice(0, 10)
    const d = getOrCreate(dateStr)
    d.spendEur = (d.spendEur ?? 0) + Math.abs(t.amount) / 100
  }

  // Completed fasts (fasting page history — a JSON blob in UserPreference).
  // Attributed to the day the fast ended.
  try {
    const fastHistory = JSON.parse(fastPref?.value ?? "[]") as { endedAt?: string; durationH?: number }[]
    if (Array.isArray(fastHistory)) {
      for (const rec of fastHistory) {
        if (!rec?.endedAt || typeof rec.durationH !== "number") continue
        const dateStr = rec.endedAt.slice(0, 10)
        if (dateStr < since60str) continue
        const d = getOrCreate(dateStr)
        if (d.fastH == null || rec.durationH > d.fastH) d.fastH = rec.durationH
      }
    }
  } catch { /* malformed blob — skip fasting */ }

  const allDays = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totalDays = allDays.length

  // The whole insight battery, runnable on any subset of days — it runs twice:
  // once on everything, once on weekdays only (the weekend confounder guard).
  const deriveInsights = (days: DayData[]): InsightResult[] => {
  const insights: InsightResult[] = []
  const byDate = Object.fromEntries(days.map(d => [d.date, d]))

  // 1. Sleep duration → next-day energy / mood
  const sleepDurHighEnergy: number[] = []
  const sleepDurLowEnergy: number[] = []
  const sleepDurHighMood: number[] = []
  const sleepDurLowMood: number[] = []
  for (const d of days) {
    if (d.sleepDuration == null) continue
    const next = byDate[nextDateStr(d.date)]
    if (!next) continue
    const isHigh = d.sleepDuration >= 7
    if (next.energy != null) { if (isHigh) sleepDurHighEnergy.push(next.energy); else sleepDurLowEnergy.push(next.energy) }
    if (next.mood != null) { if (isHigh) sleepDurHighMood.push(next.mood); else sleepDurLowMood.push(next.mood) }
  }
  const ins_sleepDur_energy = compareGroups({
    id: "sleep_duration_energy", category: "sleep", emoji: "🌙", title: "Sleep Duration & Morning Energy",
    highGroupLabel: "7h+ sleep nights", lowGroupLabel: "under 7h sleep nights",
    highValues: sleepDurHighEnergy, lowValues: sleepDurLowEnergy,
    findingTemplate: (h, l) => `After 7h+ sleep, your morning energy averages ${h} vs ${l} on shorter nights`,
  })
  if (ins_sleepDur_energy) insights.push(ins_sleepDur_energy)
  const ins_sleepDur_mood = compareGroups({
    id: "sleep_duration_mood", category: "sleep", emoji: "😊", title: "Sleep Duration & Morning Mood",
    highGroupLabel: "7h+ sleep nights", lowGroupLabel: "under 7h sleep nights",
    highValues: sleepDurHighMood, lowValues: sleepDurLowMood,
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
    if (next.energy != null) { if (isHigh) sleepScoreHighEnergy.push(next.energy); else sleepScoreLowEnergy.push(next.energy) }
    if (next.mood != null) { if (isHigh) sleepScoreHighMood.push(next.mood); else sleepScoreLowMood.push(next.mood) }
  }
  const ins_sleepScore_energy = compareGroups({
    id: "sleep_score_energy", category: "sleep", emoji: "⚡", title: "Sleep Score & Morning Energy",
    highGroupLabel: "80+ sleep score nights", lowGroupLabel: "below 80 sleep score nights",
    highValues: sleepScoreHighEnergy, lowValues: sleepScoreLowEnergy,
    findingTemplate: (h, l) => `On high sleep score nights (80+), next-day energy averages ${h} vs ${l}`,
  })
  if (ins_sleepScore_energy) insights.push(ins_sleepScore_energy)
  const ins_sleepScore_mood = compareGroups({
    id: "sleep_score_mood", category: "sleep", emoji: "🌟", title: "Sleep Score & Morning Mood",
    highGroupLabel: "80+ sleep score nights", lowGroupLabel: "below 80 sleep score nights",
    highValues: sleepScoreHighMood, lowValues: sleepScoreLowMood,
    findingTemplate: (h, l) => `On high sleep score nights (80+), next-day mood averages ${h} vs ${l}`,
  })
  if (ins_sleepScore_mood) insights.push(ins_sleepScore_mood)

  // 3. Stress → same-night sleep score & next-day mood
  const stressHighSleep: number[] = []
  const stressLowSleep: number[] = []
  const stressHighMood: number[] = []
  const stressLowMood: number[] = []
  for (const d of days) {
    if (d.stressHighMin == null) continue
    const isHigh = d.stressHighMin >= 60
    if (d.sleepScore != null) { if (isHigh) stressHighSleep.push(d.sleepScore); else stressLowSleep.push(d.sleepScore) }
    const next = byDate[nextDateStr(d.date)]
    if (next?.mood != null) { if (isHigh) stressHighMood.push(next.mood); else stressLowMood.push(next.mood) }
  }
  const ins_stress_sleep = compareGroups({
    id: "stress_sleep", category: "stress", emoji: "😤", title: "High Stress & Sleep Quality",
    highGroupLabel: "60+ min high stress days", lowGroupLabel: "low stress days",
    highValues: stressHighSleep, lowValues: stressLowSleep, higherIsBetter: true,
    findingTemplate: (h, l) => `On high-stress days (60+ min), your sleep score averages ${h} vs ${l} on calmer days`,
  })
  if (ins_stress_sleep) insights.push(ins_stress_sleep)
  const ins_stress_mood = compareGroups({
    id: "stress_mood", category: "stress", emoji: "🧘", title: "High Stress & Next-Day Mood",
    highGroupLabel: "60+ min high stress days", lowGroupLabel: "low stress days",
    highValues: stressHighMood, lowValues: stressLowMood, higherIsBetter: true,
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
    if (d.mood != null) { if (isHigh) habitHighMood.push(d.mood); else habitLowMood.push(d.mood) }
    if (d.energy != null) { if (isHigh) habitHighEnergy.push(d.energy); else habitLowEnergy.push(d.energy) }
  }
  const habitLabel = `${habitThreshold}+ habits completed`
  const ins_habit_mood = compareGroups({
    id: "habits_mood", category: "habits", emoji: "✅", title: "Habit Completion & Mood",
    highGroupLabel: habitLabel, lowGroupLabel: `fewer than ${habitThreshold} habits`,
    highValues: habitHighMood, lowValues: habitLowMood,
    findingTemplate: (h, l) => `On days you complete ${habitThreshold}+ habits, mood averages ${h} vs ${l} on lower-completion days`,
  })
  if (ins_habit_mood) insights.push(ins_habit_mood)
  const ins_habit_energy = compareGroups({
    id: "habits_energy", category: "habits", emoji: "🎯", title: "Habit Completion & Energy",
    highGroupLabel: habitLabel, lowGroupLabel: `fewer than ${habitThreshold} habits`,
    highValues: habitHighEnergy, lowValues: habitLowEnergy,
    findingTemplate: (h, l) => `On days you complete ${habitThreshold}+ habits, morning energy averages ${h} vs ${l}`,
  })
  if (ins_habit_energy) insights.push(ins_habit_energy)

  // 5. Caffeine → same-night sleep score
  const caffeineHighSleep: number[] = []
  const caffeineLowSleep: number[] = []
  for (const d of days) {
    if (d.caffeineMg == null || d.sleepScore == null) continue
    if (d.caffeineMg >= 200) caffeineHighSleep.push(d.sleepScore)
    else caffeineLowSleep.push(d.sleepScore)
  }
  const ins_caffeine_sleep = compareGroups({
    id: "caffeine_sleep", category: "caffeine", emoji: "☕", title: "Caffeine Intake & Sleep Quality",
    highGroupLabel: "200mg+ caffeine days", lowGroupLabel: "under 200mg caffeine days",
    highValues: caffeineHighSleep, lowValues: caffeineLowSleep,
    findingTemplate: (h, l) =>
      h < l
        ? `High caffeine days (200mg+) link to a sleep score of ${h} vs ${l} on lower-caffeine days`
        : `Interestingly, high caffeine days (200mg+) don't hurt your sleep — avg score ${h} vs ${l}`,
  })
  if (ins_caffeine_sleep) insights.push(ins_caffeine_sleep)

  // 6. Alcohol → next-day HRV and sleep
  const alcoholHighHrv: number[] = []
  const alcoholLowHrv: number[] = []
  const alcoholHighSleepEff: number[] = []
  const alcoholLowSleepEff: number[] = []
  for (const d of days) {
    const drank = (d.alcoholMl ?? 0) > 50
    const next = byDate[nextDateStr(d.date)]
    if (!next) continue
    if (next.hrv != null) { if (drank) alcoholHighHrv.push(next.hrv); else alcoholLowHrv.push(next.hrv) }
    if (next.sleepScore != null) { if (drank) alcoholHighSleepEff.push(next.sleepScore); else alcoholLowSleepEff.push(next.sleepScore) }
  }
  const ins_alcohol_hrv = compareGroups({
    id: "alcohol_hrv", category: "caffeine", emoji: "🍷", title: "Alcohol & Next-Day HRV",
    highGroupLabel: "drinking days (50ml+)", lowGroupLabel: "non-drinking days",
    highValues: alcoholHighHrv, lowValues: alcoholLowHrv, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h < l
        ? `After drinking, your HRV drops to ${h}ms vs ${l}ms on sober nights`
        : `Drinking days don't show an HRV penalty — ${h}ms vs ${l}ms baseline`,
  })
  if (ins_alcohol_hrv) insights.push(ins_alcohol_hrv)
  const ins_alcohol_sleep = compareGroups({
    id: "alcohol_sleep", category: "caffeine", emoji: "🍺", title: "Alcohol & Sleep Quality",
    highGroupLabel: "drinking days (50ml+)", lowGroupLabel: "non-drinking days",
    highValues: alcoholHighSleepEff, lowValues: alcoholLowSleepEff, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h < l
        ? `After drinking, sleep score averages ${h} vs ${l} on sober nights`
        : `Drinking days don't show a sleep penalty — score ${h} vs ${l}`,
  })
  if (ins_alcohol_sleep) insights.push(ins_alcohol_sleep)

  // 6a/6b. Sleep duration & alcohol → next-day resting HR
  const sleepRhrHigh: number[] = []
  const sleepRhrLow: number[] = []
  const alcoholRhrDrink: number[] = []
  const alcoholRhrSober: number[] = []
  for (const d of days) {
    const next = byDate[nextDateStr(d.date)]
    if (!next || next.restingHR == null) continue
    if (d.sleepDuration != null) {
      if (d.sleepDuration >= 7) sleepRhrHigh.push(next.restingHR)
      else sleepRhrLow.push(next.restingHR)
    }
    if (d.alcoholMl != null || d.sleepDuration != null) {
      const drank = (d.alcoholMl ?? 0) > 50
      if (drank) alcoholRhrDrink.push(next.restingHR)
      else alcoholRhrSober.push(next.restingHR)
    }
  }
  const ins_sleep_rhr = compareGroups({
    id: "sleep_resting_hr", category: "recovery", emoji: "❤️", title: "Sleep Duration & Resting Heart Rate",
    highGroupLabel: "after 7h+ sleep", lowGroupLabel: "after under 7h",
    highValues: sleepRhrHigh, lowValues: sleepRhrLow, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h < l
        ? `After 7h+ sleep, your resting HR averages ${h} bpm vs ${l} bpm on shorter nights`
        : `Sleep length doesn't move your resting HR much — ${h} bpm vs ${l} bpm`,
  })
  if (ins_sleep_rhr) insights.push(ins_sleep_rhr)
  const ins_alcohol_rhr = compareGroups({
    id: "alcohol_resting_hr", category: "recovery", emoji: "🍷", title: "Alcohol & Resting Heart Rate",
    highGroupLabel: "drinking days (50ml+)", lowGroupLabel: "non-drinking days",
    highValues: alcoholRhrDrink, lowValues: alcoholRhrSober, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h > l
        ? `After drinking, your resting HR rises to ${h} bpm vs ${l} bpm on sober nights`
        : `Drinking days don't elevate your resting HR — ${h} bpm vs ${l} bpm`,
  })
  if (ins_alcohol_rhr) insights.push(ins_alcohol_rhr)

  // 6c. Activity (steps) → that-night sleep & next-day readiness
  const STEP_HIGH = 8000
  const activeSleepHigh: number[] = []
  const activeSleepLow: number[] = []
  const activeReadinessHigh: number[] = []
  const activeReadinessLow: number[] = []
  for (const d of days) {
    if (d.steps == null) continue
    const isActive = d.steps >= STEP_HIGH
    if (d.sleepScore != null) { if (isActive) activeSleepHigh.push(d.sleepScore); else activeSleepLow.push(d.sleepScore) }
    const next = byDate[nextDateStr(d.date)]
    if (next?.readiness != null) { if (isActive) activeReadinessHigh.push(next.readiness); else activeReadinessLow.push(next.readiness) }
  }
  const ins_active_sleep = compareGroups({
    id: "activity_sleep", category: "recovery", emoji: "🚶", title: "Activity Load & Sleep Quality",
    highGroupLabel: "active days (8k+ steps)", lowGroupLabel: "lower-activity days",
    highValues: activeSleepHigh, lowValues: activeSleepLow, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h > l
        ? `On active days (8k+ steps), your sleep score averages ${h} vs ${l} on quieter days`
        : `More steps don't improve your sleep score — ${h} vs ${l}`,
  })
  if (ins_active_sleep) insights.push(ins_active_sleep)
  const ins_active_readiness = compareGroups({
    id: "activity_readiness", category: "recovery", emoji: "🔋", title: "Activity Load & Next-Day Readiness",
    highGroupLabel: "active days (8k+ steps)", lowGroupLabel: "lower-activity days",
    highValues: activeReadinessHigh, lowValues: activeReadinessLow, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h >= l
        ? `After active days (8k+ steps), next-day readiness averages ${h} vs ${l}`
        : `Hard activity days cost you next-day readiness — ${h} vs ${l} after quieter days`,
  })
  if (ins_active_readiness) insights.push(ins_active_readiness)

  // 6d. High stress → same-day HRV
  const stressHrvHigh: number[] = []
  const stressHrvLow: number[] = []
  for (const d of days) {
    if (d.stressHighMin == null || d.hrv == null) continue
    if (d.stressHighMin >= 60) stressHrvHigh.push(d.hrv)
    else stressHrvLow.push(d.hrv)
  }
  const ins_stress_hrv = compareGroups({
    id: "stress_hrv", category: "recovery", emoji: "💓", title: "High Stress & HRV",
    highGroupLabel: "60+ min high stress", lowGroupLabel: "calmer days",
    highValues: stressHrvHigh, lowValues: stressHrvLow, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h < l
        ? `On high-stress days, your HRV averages ${h}ms vs ${l}ms on calmer days`
        : `High-stress days don't suppress your HRV — ${h}ms vs ${l}ms`,
  })
  if (ins_stress_hrv) insights.push(ins_stress_hrv)

  // 6e. Caffeine → next-day readiness
  const caffeineReadinessHigh: number[] = []
  const caffeineReadinessLow: number[] = []
  for (const d of days) {
    if (d.caffeineMg == null) continue
    const next = byDate[nextDateStr(d.date)]
    if (next?.readiness == null) continue
    if (d.caffeineMg >= 200) caffeineReadinessHigh.push(next.readiness)
    else caffeineReadinessLow.push(next.readiness)
  }
  const ins_caffeine_readiness = compareGroups({
    id: "caffeine_readiness", category: "recovery", emoji: "☕", title: "Caffeine & Next-Day Readiness",
    highGroupLabel: "200mg+ caffeine days", lowGroupLabel: "under 200mg days",
    highValues: caffeineReadinessHigh, lowValues: caffeineReadinessLow, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h < l
        ? `After 200mg+ caffeine, next-day readiness averages ${h} vs ${l} on lower-caffeine days`
        : `Higher caffeine days don't dent your readiness — ${h} vs ${l}`,
  })
  if (ins_caffeine_readiness) insights.push(ins_caffeine_readiness)

  // 7. Tag insights — top 5 most common tags
  const tagCounts: Record<string, number> = {}
  for (const d of days) {
    for (const tag of d.tags ?? []) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag]) => tag)
  for (const tag of topTags) {
    const tagMoodHigh: number[] = []
    const tagMoodLow: number[] = []
    const tagEnergyHigh: number[] = []
    const tagEnergyLow: number[] = []
    for (const d of days) {
      const hasTag = (d.tags ?? []).includes(tag)
      if (d.mood != null) { if (hasTag) tagMoodHigh.push(d.mood); else tagMoodLow.push(d.mood) }
      if (d.energy != null) { if (hasTag) tagEnergyHigh.push(d.energy); else tagEnergyLow.push(d.energy) }
    }
    const safeTag = tag.toLowerCase().replace(/[^a-z0-9]/g, "_")
    const ins_tag_mood = compareGroups({
      id: `tag_${safeTag}_mood`, category: "tags", emoji: "🏷️", title: `"${tag}" Days & Mood`,
      highGroupLabel: `${tag} days`, lowGroupLabel: `non-${tag} days`,
      highValues: tagMoodHigh, lowValues: tagMoodLow,
      findingTemplate: (h, l) => `On "${tag}" days, mood averages ${h} vs ${l} on other days`,
    })
    if (ins_tag_mood) insights.push(ins_tag_mood)
    const ins_tag_energy = compareGroups({
      id: `tag_${safeTag}_energy`, category: "tags", emoji: "⚡", title: `"${tag}" Days & Energy`,
      highGroupLabel: `${tag} days`, lowGroupLabel: `non-${tag} days`,
      highValues: tagEnergyHigh, lowValues: tagEnergyLow,
      findingTemplate: (h, l) => `On "${tag}" days, morning energy averages ${h} vs ${l} on other days`,
    })
    if (ins_tag_energy) insights.push(ins_tag_energy)
  }

  // 8. Weather
  const daysWithWeather = days.filter(d => d.precipMm != null || d.tempMaxC != null)
  if (daysWithWeather.length >= 10) {
    const rainSleep: number[] = []
    const noRainSleep: number[] = []
    const rainMood: number[] = []
    const noRainMood: number[] = []
    for (const d of daysWithWeather) {
      if (d.precipMm == null) continue
      const isRainy = d.precipMm > 1
      const next = byDate[nextDateStr(d.date)]
      if (d.sleepScore != null) { if (isRainy) rainSleep.push(d.sleepScore); else noRainSleep.push(d.sleepScore) }
      if (next?.mood != null) { if (isRainy) rainMood.push(next.mood); else noRainMood.push(next.mood) }
    }
    const ins_rain_sleep = compareGroups({
      id: "rain_sleep", category: "tags", emoji: "🌧️", title: "Rainy Days & Sleep Quality",
      highGroupLabel: "rainy days", lowGroupLabel: "dry days",
      highValues: rainSleep, lowValues: noRainSleep, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `You sleep better on rainy nights — sleep score ${h} vs ${l} on dry nights`
          : `Rainy nights don't improve sleep — score ${h} vs ${l} on dry nights`,
    })
    if (ins_rain_sleep) insights.push(ins_rain_sleep)
    const ins_rain_mood = compareGroups({
      id: "rain_mood", category: "tags", emoji: "⛅", title: "Weather & Morning Mood",
      highGroupLabel: "rainy days", lowGroupLabel: "dry days",
      highValues: rainMood, lowValues: noRainMood, higherIsBetter: false,
      findingTemplate: (h, l) =>
        h < l
          ? `After rainy days, morning mood averages ${h} vs ${l} after dry days`
          : `Rain doesn't dampen your mood — ${h} vs ${l} on dry days`,
    })
    if (ins_rain_mood) insights.push(ins_rain_mood)
    const hotSteps: number[] = []
    const coolSteps: number[] = []
    for (const d of daysWithWeather) {
      if (d.tempMaxC == null || d.steps == null) continue
      if (d.tempMaxC > 25) hotSteps.push(d.steps)
      else coolSteps.push(d.steps)
    }
    const ins_heat_steps = compareGroups({
      id: "heat_steps", category: "tags", emoji: "🌡️", title: "Hot Days & Step Count",
      highGroupLabel: "hot days (25°C+)", lowGroupLabel: "cooler days",
      highValues: hotSteps, lowValues: coolSteps, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `You walk more on hot days — ${Math.round(h).toLocaleString()} steps vs ${Math.round(l).toLocaleString()} on cooler days`
          : `You walk more on cooler days — ${Math.round(l).toLocaleString()} steps vs ${Math.round(h).toLocaleString()} when it's hot`,
    })
    if (ins_heat_steps) insights.push(ins_heat_steps)
  }

  // 9. Screen time → sleep & next-day energy/mood/readiness
  const screenVals = days.filter(d => d.screenTimeMin != null).map(d => d.screenTimeMin!)
  if (screenVals.length >= 10) {
    const screenMedian = median(screenVals)
    const fmtH = (min: number) => (min >= 60 ? `${(min / 60).toFixed(1)}h` : `${Math.round(min)}m`)
    const screenSleepHigh: number[] = []
    const screenSleepLow: number[] = []
    const screenEnergyHigh: number[] = []
    const screenEnergyLow: number[] = []
    const screenMoodHigh: number[] = []
    const screenMoodLow: number[] = []
    const screenReadinessHigh: number[] = []
    const screenReadinessLow: number[] = []
    for (const d of days) {
      if (d.screenTimeMin == null) continue
      const isHigh = d.screenTimeMin >= screenMedian
      if (d.sleepScore != null) { if (isHigh) screenSleepHigh.push(d.sleepScore); else screenSleepLow.push(d.sleepScore) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.energy != null) { if (isHigh) screenEnergyHigh.push(next.energy); else screenEnergyLow.push(next.energy) }
      if (next?.mood != null) { if (isHigh) screenMoodHigh.push(next.mood); else screenMoodLow.push(next.mood) }
      if (next?.readiness != null) { if (isHigh) screenReadinessHigh.push(next.readiness); else screenReadinessLow.push(next.readiness) }
    }
    const ins_screen_sleep = compareGroups({
      id: "screen_sleep", category: "screen", emoji: "📱", title: "Screen Time & Sleep Quality",
      highGroupLabel: `high screen days (${fmtH(screenMedian)}+)`, lowGroupLabel: "lower screen days",
      highValues: screenSleepHigh, lowValues: screenSleepLow, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `On high screen-time days (${fmtH(screenMedian)}+), your sleep score averages ${h} vs ${l} on lighter days`
          : `More screen time doesn't hurt your sleep score — ${h} vs ${l}`,
    })
    if (ins_screen_sleep) insights.push(ins_screen_sleep)
    const ins_screen_energy = compareGroups({
      id: "screen_energy", category: "screen", emoji: "🔌", title: "Screen Time & Next-Day Energy",
      highGroupLabel: `high screen days (${fmtH(screenMedian)}+)`, lowGroupLabel: "lower screen days",
      highValues: screenEnergyHigh, lowValues: screenEnergyLow, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After high screen-time days, next-day energy averages ${h} vs ${l} after lighter days`
          : `Screen time doesn't dent your next-day energy — ${h} vs ${l}`,
    })
    if (ins_screen_energy) insights.push(ins_screen_energy)
    const ins_screen_mood = compareGroups({
      id: "screen_mood", category: "screen", emoji: "🙂", title: "Screen Time & Next-Day Mood",
      highGroupLabel: `high screen days (${fmtH(screenMedian)}+)`, lowGroupLabel: "lower screen days",
      highValues: screenMoodHigh, lowValues: screenMoodLow, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After high screen-time days, next-day mood averages ${h} vs ${l} after lighter days`
          : `Screen time doesn't dent your next-day mood — ${h} vs ${l}`,
    })
    if (ins_screen_mood) insights.push(ins_screen_mood)
    const ins_screen_readiness = compareGroups({
      id: "screen_readiness", category: "screen", emoji: "🔋", title: "Screen Time & Next-Day Readiness",
      highGroupLabel: `high screen days (${fmtH(screenMedian)}+)`, lowGroupLabel: "lower screen days",
      highValues: screenReadinessHigh, lowValues: screenReadinessLow, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After high screen-time days, next-day readiness averages ${h} vs ${l}`
          : `Screen time doesn't dent your next-day readiness — ${h} vs ${l}`,
    })
    if (ins_screen_readiness) insights.push(ins_screen_readiness)
  }

  // 10. Wake time (first phone unlock) → morning energy & mood
  const wakeVals = days.filter(d => d.firstUnlockMin != null).map(d => d.firstUnlockMin!)
  if (wakeVals.length >= 10) {
    const wakeMedian = median(wakeVals)
    const fmtClock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`
    const earlyEnergy: number[] = []
    const lateEnergy: number[] = []
    const earlyMood: number[] = []
    const lateMood: number[] = []
    for (const d of days) {
      if (d.firstUnlockMin == null) continue
      const isEarly = d.firstUnlockMin < wakeMedian
      if (d.energy != null) { if (isEarly) earlyEnergy.push(d.energy); else lateEnergy.push(d.energy) }
      if (d.mood != null) { if (isEarly) earlyMood.push(d.mood); else lateMood.push(d.mood) }
    }
    const ins_wake_energy = compareGroups({
      id: "wake_energy", category: "screen", emoji: "🌅", title: "Wake Time & Morning Energy",
      highGroupLabel: `early starts (before ${fmtClock(wakeMedian)})`, lowGroupLabel: "later starts",
      highValues: earlyEnergy, lowValues: lateEnergy, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `On days you reach for your phone before ${fmtClock(wakeMedian)}, morning energy averages ${h} vs ${l} on later starts`
          : `Earlier starts don't boost your energy — ${h} vs ${l} on later starts`,
    })
    if (ins_wake_energy) insights.push(ins_wake_energy)
    const ins_wake_mood = compareGroups({
      id: "wake_mood", category: "screen", emoji: "☀️", title: "Wake Time & Morning Mood",
      highGroupLabel: `early starts (before ${fmtClock(wakeMedian)})`, lowGroupLabel: "later starts",
      highValues: earlyMood, lowValues: lateMood, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `On earlier starts (before ${fmtClock(wakeMedian)}), morning mood averages ${h} vs ${l} on later starts`
          : `Earlier starts don't lift your mood — ${h} vs ${l} on later starts`,
    })
    if (ins_wake_mood) insights.push(ins_wake_mood)
  }

  // 11. Calendar load → sleep & next-day energy/mood (busy vs quiet days)
  const loadVals = days.filter(d => d.eventCount != null).map(d => d.eventCount!)
  if (loadVals.length >= 10) {
    const loadMedian = Math.max(1, median(loadVals))
    const busySleep: number[] = [], quietSleep: number[] = []
    const busyEnergy: number[] = [], quietEnergy: number[] = []
    const busyMood: number[] = [], quietMood: number[] = []
    for (const d of days) {
      const load = d.eventCount ?? 0
      const isBusy = load >= loadMedian && load > 0
      if (d.sleepScore != null) { if (isBusy) busySleep.push(d.sleepScore); else quietSleep.push(d.sleepScore) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.energy != null) { if (isBusy) busyEnergy.push(next.energy); else quietEnergy.push(next.energy) }
      if (next?.mood != null) { if (isBusy) busyMood.push(next.mood); else quietMood.push(next.mood) }
    }
    const ins_load_sleep = compareGroups({
      id: "calendar_load_sleep", category: "calendar", emoji: "🗓️", title: "Busy Days & Sleep",
      highGroupLabel: `busy days (${loadMedian}+ events)`, lowGroupLabel: "quieter days",
      highValues: busySleep, lowValues: quietSleep, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `On busier days (${loadMedian}+ events), your sleep score averages ${h} vs ${l} on quieter days`
          : `A packed calendar doesn't hurt your sleep — ${h} vs ${l}`,
    })
    if (ins_load_sleep) insights.push(ins_load_sleep)
    const ins_load_energy = compareGroups({
      id: "calendar_load_energy", category: "calendar", emoji: "🗓️", title: "Busy Days & Next-Day Energy",
      highGroupLabel: `busy days (${loadMedian}+ events)`, lowGroupLabel: "quieter days",
      highValues: busyEnergy, lowValues: quietEnergy, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After busy days, next-day energy averages ${h} vs ${l} after quieter ones`
          : `Busy days don't drain your next-day energy — ${h} vs ${l}`,
    })
    if (ins_load_energy) insights.push(ins_load_energy)
    const ins_load_mood = compareGroups({
      id: "calendar_load_mood", category: "calendar", emoji: "🗓️", title: "Busy Days & Next-Day Mood",
      highGroupLabel: `busy days (${loadMedian}+ events)`, lowGroupLabel: "quieter days",
      highValues: busyMood, lowValues: quietMood, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After busy days, next-day mood averages ${h} vs ${l} after quieter ones`
          : `Busy days don't dent your next-day mood — ${h} vs ${l}`,
    })
    if (ins_load_mood) insights.push(ins_load_mood)
  }

  // 12. Per-activity — auto-discover recurring event titles (e.g. "Záhrada")
  // and compare days that have them vs days that don't. No hardcoded keywords:
  // the activities surface from whatever recurs on your own calendar.
  const dayCountByTitle = new Map<string, number>()
  for (const d of days) {
    for (const t of new Set((d.eventTitles ?? []).filter(Boolean))) {
      dayCountByTitle.set(t, (dayCountByTitle.get(t) ?? 0) + 1)
    }
  }
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x"
  const frequentTitles = [...dayCountByTitle.entries()]
    .filter(([t, n]) => t.length >= 2 && n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => t)
  for (const title of frequentTitles) {
    const withSteps: number[] = [], withoutSteps: number[] = []
    const withEnergy: number[] = [], withoutEnergy: number[] = []
    for (const d of days) {
      const has = (d.eventTitles ?? []).some(t => t === title)
      if (d.steps != null) { if (has) withSteps.push(d.steps); else withoutSteps.push(d.steps) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.energy != null) { if (has) withEnergy.push(next.energy); else withoutEnergy.push(next.energy) }
    }
    const ins_act_steps = compareGroups({
      id: `calendar_${slug(title)}_steps`, category: "calendar", emoji: "📅", title: `"${title}" days & Steps`,
      highGroupLabel: `"${title}" days`, lowGroupLabel: "other days",
      highValues: withSteps, lowValues: withoutSteps, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `On "${title}" days you average ${Math.round(h).toLocaleString()} steps vs ${Math.round(l).toLocaleString()} on other days`
          : `"${title}" days aren't your most active — ${Math.round(h).toLocaleString()} vs ${Math.round(l).toLocaleString()} steps`,
    })
    if (ins_act_steps) insights.push(ins_act_steps)
    const ins_act_energy = compareGroups({
      id: `calendar_${slug(title)}_energy`, category: "calendar", emoji: "📅", title: `"${title}" days & Next-Day Energy`,
      highGroupLabel: `"${title}" days`, lowGroupLabel: "other days",
      highValues: withEnergy, lowValues: withoutEnergy, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h > l
          ? `The day after "${title}", energy averages ${h} vs ${l} otherwise`
          : `"${title}" days don't lift your next-day energy — ${h} vs ${l}`,
    })
    if (ins_act_energy) insights.push(ins_act_energy)
  }

  // 13. Food (photo-logged meals) — timing, protein, calories, sugar
  const foodDays = days.filter(d => d.calories != null)
  if (foodDays.length >= 10) {
    // 13a. Late eating → that night's sleep
    const LATE_MEAL_MIN = 20 * 60
    const lateSleep: number[] = [], earlySleep: number[] = []
    for (const d of foodDays) {
      if (d.lastMealMin == null) continue
      const night = byDate[nextDateStr(d.date)]
      if (night?.sleepScore == null) continue
      if (d.lastMealMin >= LATE_MEAL_MIN) lateSleep.push(night.sleepScore)
      else earlySleep.push(night.sleepScore)
    }
    const ins_late_meal = compareGroups({
      id: "food_late_meal_sleep", category: "food", emoji: "🌙", title: "Late Meals & Sleep Quality",
      highGroupLabel: "last meal after 20:00", lowGroupLabel: "earlier dinners",
      highValues: lateSleep, lowValues: earlySleep, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `When your last meal is after 20:00, that night's sleep score averages ${h} vs ${l} after earlier dinners`
          : `Late dinners don't hurt your sleep — score ${h} vs ${l} after earlier meals`,
    })
    if (ins_late_meal) insights.push(ins_late_meal)

    // 13b. Protein → next-day energy
    const proteinVals = foodDays.filter(d => d.proteinG != null).map(d => d.proteinG!)
    if (proteinVals.length >= 10) {
      const proteinMedian = median(proteinVals)
      const highProtEnergy: number[] = [], lowProtEnergy: number[] = []
      for (const d of foodDays) {
        if (d.proteinG == null) continue
        const next = byDate[nextDateStr(d.date)]
        if (next?.energy == null) continue
        if (d.proteinG >= proteinMedian) highProtEnergy.push(next.energy)
        else lowProtEnergy.push(next.energy)
      }
      const ins_protein_energy = compareGroups({
        id: "food_protein_energy", category: "food", emoji: "🥩", title: "Protein & Next-Day Energy",
        highGroupLabel: `${Math.round(proteinMedian)}g+ protein days`, lowGroupLabel: "lower-protein days",
        highValues: highProtEnergy, lowValues: lowProtEnergy,
        findingTemplate: (h, l) =>
          h > l
            ? `After higher-protein days (${Math.round(proteinMedian)}g+), morning energy averages ${h} vs ${l}`
            : `More protein doesn't move your morning energy — ${h} vs ${l}`,
      })
      if (ins_protein_energy) insights.push(ins_protein_energy)
    }

    // 13c. Calories → that night's sleep
    const calMedian = median(foodDays.map(d => d.calories!))
    const highCalSleep: number[] = [], lowCalSleep: number[] = []
    for (const d of foodDays) {
      const night = byDate[nextDateStr(d.date)]
      if (night?.sleepScore == null) continue
      if (d.calories! >= calMedian) highCalSleep.push(night.sleepScore)
      else lowCalSleep.push(night.sleepScore)
    }
    const ins_cal_sleep = compareGroups({
      id: "food_calories_sleep", category: "food", emoji: "🔥", title: "Calorie Load & Sleep Quality",
      highGroupLabel: `${Math.round(calMedian)}+ kcal days`, lowGroupLabel: "lighter days",
      highValues: highCalSleep, lowValues: lowCalSleep, higherIsBetter: true,
      findingTemplate: (h, l) =>
        h < l
          ? `After heavier days (${Math.round(calMedian)}+ kcal), sleep score averages ${h} vs ${l} after lighter days`
          : `Bigger eating days don't hurt your sleep — ${h} vs ${l}`,
    })
    if (ins_cal_sleep) insights.push(ins_cal_sleep)

    // 13d. Sugar → next-day energy & mood
    const sugarVals = foodDays.filter(d => d.sugarG != null).map(d => d.sugarG!)
    if (sugarVals.length >= 10) {
      const sugarMedian = median(sugarVals)
      const highSugarEnergy: number[] = [], lowSugarEnergy: number[] = []
      const highSugarMood: number[] = [], lowSugarMood: number[] = []
      for (const d of foodDays) {
        if (d.sugarG == null) continue
        const next = byDate[nextDateStr(d.date)]
        if (!next) continue
        const isHigh = d.sugarG >= sugarMedian
        if (next.energy != null) { if (isHigh) highSugarEnergy.push(next.energy); else lowSugarEnergy.push(next.energy) }
        if (next.mood != null) { if (isHigh) highSugarMood.push(next.mood); else lowSugarMood.push(next.mood) }
      }
      const ins_sugar_energy = compareGroups({
        id: "food_sugar_energy", category: "food", emoji: "🍬", title: "Sugar & Next-Day Energy",
        highGroupLabel: `${Math.round(sugarMedian)}g+ sugar days`, lowGroupLabel: "lower-sugar days",
        highValues: highSugarEnergy, lowValues: lowSugarEnergy,
        findingTemplate: (h, l) =>
          h < l
            ? `After higher-sugar days (${Math.round(sugarMedian)}g+), morning energy averages ${h} vs ${l}`
            : `Sugar days don't dent your next-day energy — ${h} vs ${l}`,
      })
      if (ins_sugar_energy) insights.push(ins_sugar_energy)
      const ins_sugar_mood = compareGroups({
        id: "food_sugar_mood", category: "food", emoji: "🍭", title: "Sugar & Next-Day Mood",
        highGroupLabel: `${Math.round(sugarMedian)}g+ sugar days`, lowGroupLabel: "lower-sugar days",
        highValues: highSugarMood, lowValues: lowSugarMood,
        findingTemplate: (h, l) =>
          h < l
            ? `After higher-sugar days (${Math.round(sugarMedian)}g+), morning mood averages ${h} vs ${l}`
            : `Sugar days don't dent your next-day mood — ${h} vs ${l}`,
      })
      if (ins_sugar_mood) insights.push(ins_sugar_mood)
    }
  }

  // 14. Hydration → next-day energy & readiness (the app has always tracked
  // water; this is the first time it checks whether it matters)
  const WATER_GOAL = 2000
  const hydratedEnergy: number[] = [], dryEnergy: number[] = []
  const hydratedReadiness: number[] = [], dryReadiness: number[] = []
  for (const d of days) {
    if (d.waterMl == null) continue
    const next = byDate[nextDateStr(d.date)]
    if (!next) continue
    const hydrated = d.waterMl >= WATER_GOAL
    if (next.energy != null) { if (hydrated) hydratedEnergy.push(next.energy); else dryEnergy.push(next.energy) }
    if (next.readiness != null) { if (hydrated) hydratedReadiness.push(next.readiness); else dryReadiness.push(next.readiness) }
  }
  const ins_water_energy = compareGroups({
    id: "water_energy", category: "food", emoji: "💧", title: "Hydration & Next-Day Energy",
    highGroupLabel: "2L+ water days", lowGroupLabel: "under 2L days",
    highValues: hydratedEnergy, lowValues: dryEnergy,
    findingTemplate: (h, l) =>
      h > l
        ? `After 2L+ water days, morning energy averages ${h} vs ${l} after drier days`
        : `Hitting 2L doesn't move your morning energy — ${h} vs ${l}`,
  })
  if (ins_water_energy) insights.push(ins_water_energy)
  const ins_water_readiness = compareGroups({
    id: "water_readiness", category: "food", emoji: "🚰", title: "Hydration & Next-Day Readiness",
    highGroupLabel: "2L+ water days", lowGroupLabel: "under 2L days",
    highValues: hydratedReadiness, lowValues: dryReadiness,
    findingTemplate: (h, l) =>
      h > l
        ? `After 2L+ water days, next-day readiness averages ${h} vs ${l}`
        : `Hydration doesn't show up in your readiness — ${h} vs ${l}`,
  })
  if (ins_water_readiness) insights.push(ins_water_readiness)

  // 15. Supplements (Oura tags) → next-morning sleep score & HRV. Evening
  // supplements affect the night that follows, so both use the next day's
  // recordings. Auto-discovers whatever the user actually takes.
  const suppDayCount = new Map<string, number>()
  for (const d of days) {
    for (const s of d.supplements ?? []) suppDayCount.set(s, (suppDayCount.get(s) ?? 0) + 1)
  }
  const topSupps = [...suppDayCount.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s)
  const suppSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "x"
  for (const supp of topSupps) {
    const withSleep: number[] = [], withoutSleep: number[] = []
    const withHrv: number[] = [], withoutHrv: number[] = []
    for (const d of days) {
      const took = (d.supplements ?? []).includes(supp)
      const next = byDate[nextDateStr(d.date)]
      if (!next) continue
      if (next.sleepScore != null) { if (took) withSleep.push(next.sleepScore); else withoutSleep.push(next.sleepScore) }
      if (next.hrv != null) { if (took) withHrv.push(next.hrv); else withoutHrv.push(next.hrv) }
    }
    const ins_supp_sleep = compareGroups({
      id: `supplement_${suppSlug(supp)}_sleep`, category: "supplements", emoji: "💊", title: `${supp} & Sleep Quality`,
      highGroupLabel: `${supp} days`, lowGroupLabel: `days without ${supp}`,
      highValues: withSleep, lowValues: withoutSleep,
      findingTemplate: (h, l) =>
        h > l
          ? `On nights after taking ${supp}, sleep score averages ${h} vs ${l} without it`
          : `${supp} doesn't show a sleep benefit yet — ${h} vs ${l} without it`,
    })
    if (ins_supp_sleep) insights.push(ins_supp_sleep)
    const ins_supp_hrv = compareGroups({
      id: `supplement_${suppSlug(supp)}_hrv`, category: "supplements", emoji: "💓", title: `${supp} & HRV`,
      highGroupLabel: `${supp} days`, lowGroupLabel: `days without ${supp}`,
      highValues: withHrv, lowValues: withoutHrv,
      findingTemplate: (h, l) =>
        h > l
          ? `Mornings after ${supp}, HRV averages ${h}ms vs ${l}ms without it`
          : `${supp} doesn't move your HRV — ${h}ms vs ${l}ms without it`,
    })
    if (ins_supp_hrv) insights.push(ins_supp_hrv)
  }

  // 16. Workouts (Strava) — the classic wearable questions: does training help
  // you sleep, and what does it cost (or pay) in next-day recovery?
  const workoutSleep: number[] = [], restSleep: number[] = []
  const workoutReadiness: number[] = [], restReadiness: number[] = []
  const workoutHrv: number[] = [], restHrv: number[] = []
  for (const d of days) {
    const trained = (d.workoutMin ?? 0) >= 20
    if (d.sleepScore != null) { if (trained) workoutSleep.push(d.sleepScore); else restSleep.push(d.sleepScore) }
    const next = byDate[nextDateStr(d.date)]
    if (!next) continue
    if (next.readiness != null) { if (trained) workoutReadiness.push(next.readiness); else restReadiness.push(next.readiness) }
    if (next.hrv != null) { if (trained) workoutHrv.push(next.hrv); else restHrv.push(next.hrv) }
  }
  const ins_workout_sleep = compareGroups({
    id: "workout_sleep", category: "fitness", emoji: "🏃", title: "Workouts & Sleep Quality",
    highGroupLabel: "workout days (20min+)", lowGroupLabel: "rest days",
    highValues: workoutSleep, lowValues: restSleep, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h > l
        ? `On workout days, your sleep score averages ${h} vs ${l} on rest days`
        : `Workouts don't lift your sleep score — ${h} vs ${l} on rest days`,
  })
  if (ins_workout_sleep) insights.push(ins_workout_sleep)
  const ins_workout_readiness = compareGroups({
    id: "workout_readiness", category: "fitness", emoji: "🔋", title: "Workouts & Next-Day Readiness",
    highGroupLabel: "workout days (20min+)", lowGroupLabel: "rest days",
    highValues: workoutReadiness, lowValues: restReadiness, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h >= l
        ? `After workouts, next-day readiness averages ${h} vs ${l} after rest days`
        : `Workouts cost you next-day readiness — ${h} vs ${l} after rest days`,
  })
  if (ins_workout_readiness) insights.push(ins_workout_readiness)
  const ins_workout_hrv = compareGroups({
    id: "workout_hrv", category: "fitness", emoji: "💓", title: "Workouts & Next-Day HRV",
    highGroupLabel: "workout days (20min+)", lowGroupLabel: "rest days",
    highValues: workoutHrv, lowValues: restHrv, higherIsBetter: true,
    findingTemplate: (h, l) =>
      h >= l
        ? `Mornings after workouts, HRV averages ${h}ms vs ${l}ms after rest days`
        : `Mornings after workouts, HRV dips to ${h}ms vs ${l}ms after rest days`,
  })
  if (ins_workout_hrv) insights.push(ins_workout_hrv)

  // 17. Music (Last.fm) — ported from the /api/stats mini-engine so it reaches
  // the Insights page and the watch cron
  const listenVals = days.filter(d => d.listeningMin != null).map(d => d.listeningMin!)
  if (listenVals.length >= 10) {
    const listenMedian = median(listenVals)
    const musicMoodHigh: number[] = [], musicMoodLow: number[] = []
    const musicSleepHigh: number[] = [], musicSleepLow: number[] = []
    const musicFocusHigh: number[] = [], musicFocusLow: number[] = []
    for (const d of days) {
      if (d.listeningMin == null) continue
      const isHigh = d.listeningMin >= listenMedian
      if (d.mood != null) { if (isHigh) musicMoodHigh.push(d.mood); else musicMoodLow.push(d.mood) }
      if (d.sleepScore != null) { if (isHigh) musicSleepHigh.push(d.sleepScore); else musicSleepLow.push(d.sleepScore) }
      if (d.focusMin != null) { if (isHigh) musicFocusHigh.push(d.focusMin); else musicFocusLow.push(d.focusMin) }
    }
    const fmtListen = listenMedian >= 60 ? `${(listenMedian / 60).toFixed(1)}h` : `${Math.round(listenMedian)}min`
    const ins_music_mood = compareGroups({
      id: "music_mood", category: "music", emoji: "🎵", title: "Music & Mood",
      highGroupLabel: `heavy-listening days (${fmtListen}+)`, lowGroupLabel: "quieter days",
      highValues: musicMoodHigh, lowValues: musicMoodLow,
      findingTemplate: (h, l) =>
        h > l
          ? `On heavy-listening days (${fmtListen}+), mood averages ${h} vs ${l} on quieter days`
          : `More music doesn't lift your mood — ${h} vs ${l} on quieter days`,
    })
    if (ins_music_mood) insights.push(ins_music_mood)
    const ins_music_sleep = compareGroups({
      id: "music_sleep", category: "music", emoji: "🎧", title: "Music & Sleep Quality",
      highGroupLabel: `heavy-listening days (${fmtListen}+)`, lowGroupLabel: "quieter days",
      highValues: musicSleepHigh, lowValues: musicSleepLow,
      findingTemplate: (h, l) =>
        h > l
          ? `On heavy-listening days, sleep score averages ${h} vs ${l} on quieter days`
          : `Heavy-listening days link to a sleep score of ${h} vs ${l} on quieter days`,
    })
    if (ins_music_sleep) insights.push(ins_music_sleep)
    const ins_music_focus = compareGroups({
      id: "music_focus", category: "music", emoji: "🎯", title: "Music & Focus Time",
      highGroupLabel: `heavy-listening days (${fmtListen}+)`, lowGroupLabel: "quieter days",
      highValues: musicFocusHigh, lowValues: musicFocusLow,
      findingTemplate: (h, l) =>
        h > l
          ? `On heavy-listening days you log ${Math.round(h)}min of focus vs ${Math.round(l)}min on quieter days`
          : `Music days aren't your most focused — ${Math.round(h)}min vs ${Math.round(l)}min of deep work`,
    })
    if (ins_music_focus) insights.push(ins_music_focus)
  }

  // 18. Spending — also ported from /api/stats. Only days with transactions
  // count (a day with no synced card activity isn't a €0 day, just unknown).
  const spendVals = days.filter(d => d.spendEur != null).map(d => d.spendEur!)
  if (spendVals.length >= 10) {
    const spendMedian = median(spendVals)
    const spendMoodHigh: number[] = [], spendMoodLow: number[] = []
    const spendMoodNextHigh: number[] = [], spendMoodNextLow: number[] = []
    for (const d of days) {
      if (d.spendEur == null) continue
      const isHigh = d.spendEur >= spendMedian
      if (d.mood != null) { if (isHigh) spendMoodHigh.push(d.mood); else spendMoodLow.push(d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.mood != null) { if (isHigh) spendMoodNextHigh.push(next.mood); else spendMoodNextLow.push(next.mood) }
    }
    const ins_spend_mood = compareGroups({
      id: "spend_mood", category: "money", emoji: "💸", title: "Spending & Mood",
      highGroupLabel: `bigger-spend days (€${Math.round(spendMedian)}+)`, lowGroupLabel: "lighter-spend days",
      highValues: spendMoodHigh, lowValues: spendMoodLow,
      findingTemplate: (h, l) =>
        h > l
          ? `On bigger-spend days (€${Math.round(spendMedian)}+), mood averages ${h} vs ${l} on lighter days`
          : `Spending more doesn't come with better mood — ${h} vs ${l} on lighter days`,
    })
    if (ins_spend_mood) insights.push(ins_spend_mood)
    const ins_spend_mood_next = compareGroups({
      id: "spend_mood_next", category: "money", emoji: "💳", title: "Spending & Next-Day Mood",
      highGroupLabel: `bigger-spend days (€${Math.round(spendMedian)}+)`, lowGroupLabel: "lighter-spend days",
      highValues: spendMoodNextHigh, lowValues: spendMoodNextLow,
      findingTemplate: (h, l) =>
        h < l
          ? `The morning after bigger-spend days, mood averages ${h} vs ${l} after lighter days`
          : `Bigger-spend days don't dent the next morning's mood — ${h} vs ${l}`,
    })
    if (ins_spend_mood_next) insights.push(ins_spend_mood_next)
  }

  // 19. UV — the one weather column nothing consumed
  const uvDays = days.filter(d => d.uvIndex != null)
  if (uvDays.length >= 10) {
    const uvHighReadiness: number[] = [], uvLowReadiness: number[] = []
    for (const d of uvDays) {
      if (d.readiness == null) continue
      if (d.uvIndex! >= 5) uvHighReadiness.push(d.readiness)
      else uvLowReadiness.push(d.readiness)
    }
    const ins_uv_readiness = compareGroups({
      id: "uv_readiness", category: "tags", emoji: "☀️", title: "Sunny Days & Readiness",
      highGroupLabel: "high-UV days (index 5+)", lowGroupLabel: "low-UV days",
      highValues: uvHighReadiness, lowValues: uvLowReadiness,
      findingTemplate: (h, l) =>
        h > l
          ? `On sunny high-UV days, readiness averages ${h} vs ${l} on grey days`
          : `Sunny days don't show up in your readiness — ${h} vs ${l}`,
    })
    if (ins_uv_readiness) insights.push(ins_uv_readiness)
  }

  // 20. Focus sessions — do focus days feel better, and does sleep buy focus?
  const focusDayCount = days.filter(d => (d.focusMin ?? 0) > 0).length
  if (focusDayCount >= 5) {
    const focusMood: number[] = [], noFocusMood: number[] = []
    const goodSleepFocus: number[] = [], shortSleepFocus: number[] = []
    for (const d of days) {
      const focused = (d.focusMin ?? 0) > 0
      if (d.mood != null) { if (focused) focusMood.push(d.mood); else noFocusMood.push(d.mood) }
      // sleepDuration on day d is last night's sleep; no-session days are real
      // 0-minute focus days for this question
      if (d.sleepDuration != null) {
        if (d.sleepDuration >= 7) goodSleepFocus.push(d.focusMin ?? 0)
        else shortSleepFocus.push(d.focusMin ?? 0)
      }
    }
    const ins_focus_mood = compareGroups({
      id: "focus_mood", category: "focus", emoji: "🎯", title: "Focus Sessions & Mood",
      highGroupLabel: "focus-session days", lowGroupLabel: "days without deep work",
      highValues: focusMood, lowValues: noFocusMood,
      findingTemplate: (h, l) =>
        h > l
          ? `On days with a focus session, mood averages ${h} vs ${l} on days without`
          : `Focus-session days don't show a mood lift — ${h} vs ${l}`,
    })
    if (ins_focus_mood) insights.push(ins_focus_mood)
    const ins_sleep_focus = compareGroups({
      id: "sleep_focus", category: "focus", emoji: "🧠", title: "Sleep & Deep Work",
      highGroupLabel: "after 7h+ sleep", lowGroupLabel: "after shorter nights",
      highValues: goodSleepFocus, lowValues: shortSleepFocus,
      findingTemplate: (h, l) =>
        h > l
          ? `After 7h+ nights you log ${Math.round(h)}min of focus vs ${Math.round(l)}min after short sleep`
          : `Short nights don't reduce your focus time — ${Math.round(h)}min vs ${Math.round(l)}min`,
    })
    if (ins_sleep_focus) insights.push(ins_sleep_focus)
  }

  // 21. Fasting — completed fasts vs ordinary days, next morning's readings
  const fastDays = days.filter(d => d.fastH != null)
  if (fastDays.length >= 5) {
    const fastedSleep: number[] = [], fedSleep: number[] = []
    const fastedEnergy: number[] = [], fedEnergy: number[] = []
    for (const d of days) {
      const fasted = (d.fastH ?? 0) >= 14
      const next = byDate[nextDateStr(d.date)]
      if (!next) continue
      if (next.sleepScore != null) { if (fasted) fastedSleep.push(next.sleepScore); else fedSleep.push(next.sleepScore) }
      if (next.energy != null) { if (fasted) fastedEnergy.push(next.energy); else fedEnergy.push(next.energy) }
    }
    const ins_fast_sleep = compareGroups({
      id: "fasting_sleep", category: "fasting", emoji: "⏳", title: "Fasting & Sleep Quality",
      highGroupLabel: "14h+ fast days", lowGroupLabel: "non-fasting days",
      highValues: fastedSleep, lowValues: fedSleep,
      findingTemplate: (h, l) =>
        h > l
          ? `Nights after a 14h+ fast, sleep score averages ${h} vs ${l} on ordinary days`
          : `Fasting days don't improve your sleep — ${h} vs ${l} on ordinary days`,
    })
    if (ins_fast_sleep) insights.push(ins_fast_sleep)
    const ins_fast_energy = compareGroups({
      id: "fasting_energy", category: "fasting", emoji: "⚡", title: "Fasting & Next-Day Energy",
      highGroupLabel: "14h+ fast days", lowGroupLabel: "non-fasting days",
      highValues: fastedEnergy, lowValues: fedEnergy,
      findingTemplate: (h, l) =>
        h > l
          ? `Mornings after a 14h+ fast, energy averages ${h} vs ${l} after ordinary days`
          : `Fasting doesn't boost your next-morning energy — ${h} vs ${l}`,
    })
    if (ins_fast_energy) insights.push(ins_fast_energy)
  }

  // 22. Sleep architecture — deep/REM minutes were synced for months and never
  // fed into a single insight
  const caffeineDeepHigh: number[] = [], caffeineDeepLow: number[] = []
  const alcoholRemDrink: number[] = [], alcoholRemSober: number[] = []
  for (const d of days) {
    if (d.caffeineMg != null && d.deepSleepMin != null) {
      if (d.caffeineMg >= 200) caffeineDeepHigh.push(d.deepSleepMin)
      else caffeineDeepLow.push(d.deepSleepMin)
    }
    const next = byDate[nextDateStr(d.date)]
    if (next?.remSleepMin != null && (d.alcoholMl != null || d.caffeineMg != null)) {
      if ((d.alcoholMl ?? 0) > 50) alcoholRemDrink.push(next.remSleepMin)
      else alcoholRemSober.push(next.remSleepMin)
    }
  }
  const ins_caffeine_deep = compareGroups({
    id: "caffeine_deep_sleep", category: "recovery", emoji: "🌊", title: "Caffeine & Deep Sleep",
    highGroupLabel: "200mg+ caffeine days", lowGroupLabel: "under 200mg days",
    highValues: caffeineDeepHigh, lowValues: caffeineDeepLow,
    findingTemplate: (h, l) =>
      h < l
        ? `On 200mg+ caffeine days you get ${Math.round(h)}min of deep sleep vs ${Math.round(l)}min on lighter days`
        : `Caffeine isn't eating your deep sleep — ${Math.round(h)}min vs ${Math.round(l)}min`,
  })
  if (ins_caffeine_deep) insights.push(ins_caffeine_deep)
  const ins_alcohol_rem = compareGroups({
    id: "alcohol_rem_sleep", category: "recovery", emoji: "🌀", title: "Alcohol & REM Sleep",
    highGroupLabel: "drinking days (50ml+)", lowGroupLabel: "non-drinking days",
    highValues: alcoholRemDrink, lowValues: alcoholRemSober, higherIsBetter: false,
    findingTemplate: (h, l) =>
      h < l
        ? `Nights after drinking you get ${Math.round(h)}min of REM vs ${Math.round(l)}min sober`
        : `Drinking isn't cutting your REM sleep — ${Math.round(h)}min vs ${Math.round(l)}min`,
  })
  if (ins_alcohol_rem) insights.push(ins_alcohol_rem)

  return insights
  } // end deriveInsights

  const insights = deriveInsights(allDays)
  assignTiers(insights)

  // Weekend guard: alcohol, late meals, spending, music and screen time all
  // cluster on weekends — and so does sleeping in. An effect that collapses or
  // flips once weekends are excluded is probably the weekend, not the habit.
  const weekdayVersions = new Map(
    deriveInsights(allDays.filter(d => !isWeekendDate(d.date))).map(i => [i.id, i]),
  )
  for (const ins of insights) {
    const wk = weekdayVersions.get(ins.id)
    if (wk && (Math.sign(wk.delta) !== Math.sign(ins.delta) || Math.abs(wk.delta) < Math.abs(ins.delta) * 0.35)) {
      ins.weekendDriven = true
    }
  }

  insights.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return { insights, totalDays }
}
