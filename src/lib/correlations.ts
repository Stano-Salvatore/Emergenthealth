import { prisma } from "@/lib/prisma"
import { subDays, format } from "date-fns"
import { classifyOuraTag } from "@/lib/oura-tag-classify"
import { normalizeSupplement, cleanLabel } from "@/lib/supplement-normalize"
import { supplementInfoFor } from "@/lib/supplement-info"
import { hydrationMl, HYDRATING_TYPES } from "@/lib/hydration"
import { estimateHome, summariseDays, AWAY_KM } from "@/lib/day-location"
import { loadCoarsePoints } from "@/lib/day-location-load"

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
  waterMl?: number         // total fluid, weighted by type (see lib/hydration)
  calories?: number        // meals logged on the Food tab
  proteinG?: number
  sugarG?: number
  lastMealMin?: number     // minutes after local midnight of the day's last meal
  supplements?: string[]   // normalized supplement names taken (Oura tags)
  symptoms?: Record<string, number> // symptom name -> worst severity that day (1-5)
  custom?: Record<string, number>   // custom tracker values by metric id (logged days only)
  deepSleepMin?: number    // sleep architecture (Oura)
  remSleepMin?: number
  workoutMin?: number      // Strava moving time that day
  focusMin?: number        // completed focus-session minutes
  listeningMin?: number    // Last.fm music listening (estimated: tracks × 3min)
  lateTracks?: number      // scrobbles between 22:00 and 04:00 local
  musicGenre?: string      // genre of the day's top artist (ArtistGenre lookup)
  spendEur?: number        // card spending (outgoing, transfers excluded)
  uvIndex?: number
  fastH?: number           // longest completed fast ending this day
  presence?: "home" | "local" | "away" // coarse GPS day-fact (lib/day-location)
  sleptAway?: boolean      // where the night ENDING this morning was spent
  walkMin?: number         // minutes recognised as walking (ActivitySpan); 0 on tracked days
  productiveH?: number     // RescueTime productive hours
  distractingH?: number    // RescueTime distracting hours
  systolic?: number        // blood pressure — the day's average systolic
}

export type InsightResult = {
  id: string
  category: "sleep" | "stress" | "habits" | "caffeine" | "recovery" | "screen" | "tags" | "calendar" | "food" | "supplements" | "interactions" | "symptoms" | "fitness" | "music" | "money" | "focus" | "fasting" | "custom" | "places" | "work" | "heart" | "week"
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
  /** The same comparison on weekdays only — set alongside weekendDriven so the
   * card can show HOW MUCH of the effect was the weekend, not just that some was. */
  weekdayDelta?: number
}

/**
 * The windows a user can ask for.
 *
 * "year" exists because 90 days cannot see a season. A Samsung Health export
 * goes back years and all of it is stored, but the longest window on offer was
 * a quarter — so "am I worse in winter", the question a year of data is for,
 * could not be asked at all. The engine is window-agnostic; only this list
 * decided how far it was allowed to look.
 */
export const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, overall: 90, year: 365 }

/**
 * Bump when the insight battery gains or loses sources. Cached runs stamped
 * with an older version are recomputed on the next read instead of served,
 * so a new family (like custom trackers) appears immediately rather than
 * after the cache TTL happens to expire.
 */
export const ENGINE_VERSION = 6

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

// Off during the weekday-only guard pass (see the end of computeCorrelations):
// that pass exists for its deltas alone, and 1000 shuffles per family for
// p-values nobody reads was most of the engine's run time.
let permutationsOn = true

/**
 * Permutation test: shuffle the values between the two groups PERMUTATIONS
 * times and count how often chance alone produces a mean difference at least
 * as large as the observed one. Distribution-free — no normality assumptions,
 * works at the small n this engine deals in.
 */
export function permutationP(high: number[], low: number[], seedKey: string): number {
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

  // A zero baseline used to abort the comparison, because the percentage
  // change is undefined. For scores that never reach zero this never came up,
  // but symptoms live there: "headache 4/5 the day after drinking, 0 the rest
  // of the time" is the single most useful thing this engine can say, and it
  // was being discarded. Measuring against whichever side is non-zero makes
  // "only ever happens in this group" a clean 100%.
  if (highAvg === 0 && lowAvg === 0) return null
  const base = Math.abs(lowAvg) || Math.abs(highAvg)

  const rawDelta = ((highAvg - lowAvg) / base) * 100
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
    pValue: permutationsOn ? permutationP(highValues, lowValues, id) : 1,
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

    // Raw timestamps, summed per LOCAL day further down (next to water and
    // meals). The SQL used to GROUP BY the UTC date, so a nightcap at 00:30
    // Prague time counted for the day before — the one night it could not
    // have affected.
    prisma.caffeineLog.findMany({
      where: { userId, loggedAt: { gte: since60 } },
      select: { loggedAt: true, caffeineMg: true },
    }).catch(() => [] as { loggedAt: Date; caffeineMg: number }[]),

    prisma.intakeLog.findMany({
      where: { userId, type: "alcohol", loggedAt: { gte: since60 } },
      select: { loggedAt: true, amountMl: true },
    }).catch(() => [] as { loggedAt: Date; amountMl: number }[]),

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
      where: { userId, type: { in: HYDRATING_TYPES }, loggedAt: { gte: since60 } },
      select: { loggedAt: true, amountMl: true, type: true },
    }).catch(() => [] as { loggedAt: Date; amountMl: number; type: string }[]),

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
  const [moodRows, stravaRows, focusRows, lastfmRows, txRows, fastPref, symptomRows, customMetricRows, customLogRows, locPoints, travelSpans, rescueRows, bpRows] = await Promise.all([
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
    prisma.$queryRaw<{ date: string; listeningMin: number; lateTracks: number | null; topArtist: string | null }[]>`
      SELECT "date", "listeningMin", "lateTracks", "topArtist" FROM "LastfmLog"
      WHERE "userId" = ${userId} AND "date" >= ${since60str}
    `.catch(() => [] as { date: string; listeningMin: number; lateTracks: number | null; topArtist: string | null }[]),

    prisma.transaction.findMany({
      where: { userId, date: { gte: since60 }, isTransfer: false, amount: { lt: 0 } },
      select: { date: true, amount: true },
    }).catch(() => [] as { date: Date; amount: number }[]),

    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "fast:history" } },
    }).catch(() => null),

    prisma.symptomLog.findMany({
      where: { userId, day: { gte: since60str } },
      select: { day: true, name: true, severity: true },
    }).catch(() => [] as { day: string; name: string; severity: number }[]),

    // Custom trackers also live in raw-DDL tables with no Prisma model
    prisma.$queryRaw<{ id: string; name: string; emoji: string; type: string }[]>`
      SELECT "id", "name", "emoji", "type" FROM "CustomMetric" WHERE "userId" = ${userId}
    `.catch(() => [] as { id: string; name: string; emoji: string; type: string }[]),

    prisma.$queryRaw<{ metricId: string; date: string; value: number }[]>`
      SELECT "metricId", "date"::text as "date", "value" FROM "CustomMetricLog"
      WHERE "userId" = ${userId} AND "date" >= ${since60str}
    `.catch(() => [] as { metricId: string; date: string; value: number }[]),

    // GPS fixes, thinned to one per source per quarter hour — enough to say
    // home / in town / away and where the night was spent (lib/day-location),
    // which is the grain sleep and mood are recorded at anyway.
    loadCoarsePoints(userId, since60).catch(() => ({ points: [], countsBySource: {}, truncated: false })),

    // Recognised movement spans. All modes are loaded, not just walking: a day
    // with spans but no walk is a real zero-walking day, while a day with no
    // spans at all just wasn't tracked — and only the spans themselves can
    // tell those apart.
    prisma.activitySpan.findMany({
      where: { userId, start: { gte: since60 } },
      select: { start: true, end: true, mode: true },
    }).catch(() => [] as { start: Date; end: Date; mode: string }[]),

    prisma.rescuetimeLog.findMany({
      where: { userId, date: { gte: since60str } },
      select: { date: true, productiveH: true, distractingH: true },
    }).catch(() => [] as { date: string; productiveH: number | null; distractingH: number | null }[]),

    prisma.bloodPressureLog.findMany({
      where: { userId, loggedAt: { gte: since60 } },
      select: { loggedAt: true, systolic: true },
    }).catch(() => [] as { loggedAt: Date; systolic: number }[]),
  ])

  // Genres for the artists this user's days were topped by — the ArtistGenre
  // table is global (an artist is the same band for everyone), filled in by
  // the Last.fm sync and the YT Music import.
  const genreRows = await prisma.$queryRaw<{ artist: string; genre: string }[]>`
    SELECT "artist", "genre" FROM "ArtistGenre"
    WHERE "genre" IS NOT NULL AND "artist" IN (
      SELECT DISTINCT LOWER("topArtist") FROM "LastfmLog"
      WHERE "userId" = ${userId} AND "topArtist" IS NOT NULL AND "date" >= ${since60str}
    )
  `.catch(() => [] as { artist: string; genre: string }[])

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

  for (const cl of customLogRows) {
    const d = getOrCreate(cl.date.slice(0, 10))
    if (!d.custom) d.custom = {}
    d.custom[cl.metricId] = Number(cl.value)
  }

  const habitCountByDay: Record<string, number> = {}
  for (const hc of habitCompletions) {
    const dateStr = hc.date instanceof Date ? hc.date.toISOString().slice(0, 10) : String(hc.date).slice(0, 10)
    habitCountByDay[dateStr] = (habitCountByDay[dateStr] ?? 0) + 1
  }
  for (const [dateStr, count] of Object.entries(habitCountByDay)) {
    getOrCreate(dateStr).habitCount = count
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

  // Which day a timestamp belongs to, in the user's own time.
  //
  // Date-only columns are safe to slice out of an ISO string — Prisma returns
  // them at UTC midnight, which is exactly how they were stored. Timestamps are
  // not: slicing one buckets it by UTC day, so for anyone ahead of UTC
  // everything logged between local midnight and their offset was filed under
  // the previous day.
  //
  // That matters more here than anywhere else in the app. This engine joins
  // sources by day and then tests whether one moves another. A drink logged at
  // 00:30 landing on the day before is not a missing number — it is a number
  // attached to the wrong night, which is how an association nobody lived gets
  // published as a pattern.
  const tz = tzRow?.value || "UTC"
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz })
  const localDay = (d: Date): string => dayFmt.format(d)

  // The earliest synced event marks where calendar knowledge begins. A day
  // with no events after that point is a genuinely quiet day; a day before it
  // is simply unknown, and the calendar-load family must not file it under
  // "quiet" — that turned every pre-sync day into the control group.
  let calendarFrom: string | null = null
  for (const ev of (deviceEvents as { title: string; start: Date }[])) {
    const dateStr = localDay(ev.start)
    const d = getOrCreate(dateStr)
    d.eventCount = (d.eventCount ?? 0) + 1
    ;(d.eventTitles ??= []).push((ev.title ?? "").trim())
    if (calendarFrom == null || dateStr < calendarFrom) calendarFrom = dateStr
  }
  const calendarCovers = (date: string): boolean => calendarFrom != null && date >= calendarFrom

  for (const w of waterRows) {
    const dateStr = localDay(w.loggedAt)
    const d = getOrCreate(dateStr)
    d.waterMl = (d.waterMl ?? 0) + hydrationMl(w.type, w.amountMl)
  }

  for (const c of caffeineRows) {
    const d = getOrCreate(localDay(c.loggedAt))
    d.caffeineMg = (d.caffeineMg ?? 0) + Number(c.caffeineMg)
  }

  for (const a of alcoholRows) {
    const d = getOrCreate(localDay(a.loggedAt))
    d.alcoholMl = (d.alcoholMl ?? 0) + Number(a.amountMl)
  }

  // Food-tab meals: day totals, plus the local clock time of the day's last
  // meal (meal *timing* is a sleep lever the timestamps give us for free)
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
  const localMinutes = (date: Date): number => {
    const [h, m] = timeFmt.format(date).split(":").map(Number)
    return (h % 24) * 60 + m
  }
  for (const f of foodRows) {
    const dateStr = localDay(f.loggedAt)
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
    // cleanLabel, not the raw text: "Frontin 0,5 mg" and "Frontin" have to be
    // one substance or each half sits below the 5-day threshold and neither
    // ever produces an insight.
    const name = normalizeSupplement(label) ?? cleanLabel(label)
    const d = getOrCreate(t.day)
    d.supplements ??= []
    if (!d.supplements.includes(name)) d.supplements.push(name)
  }

  for (const sy of symptomRows) {
    const d = getOrCreate(sy.day)
    d.symptoms ??= {}
    if ((d.symptoms[sy.name] ?? 0) < sy.severity) d.symptoms[sy.name] = sy.severity
  }

  for (const a of stravaRows) {
    const d = getOrCreate(a.day)
    d.workoutMin = (d.workoutMin ?? 0) + Math.round(a.movingTimeSec / 60)
  }

  for (const f of focusRows) {
    const dateStr = localDay(f.endedAt)
    const d = getOrCreate(dateStr)
    d.focusMin = (d.focusMin ?? 0) + f.durationMin
  }

  const genreByArtist = new Map(genreRows.map(g => [g.artist, g.genre]))
  for (const l of lastfmRows) {
    if (l.listeningMin != null) getOrCreate(l.date).listeningMin = Number(l.listeningMin)
    if (l.lateTracks != null) getOrCreate(l.date).lateTracks = Number(l.lateTracks)
    if (l.topArtist) {
      const genre = genreByArtist.get(l.topArtist.toLowerCase())
      if (genre) getOrCreate(l.date).musicGenre = genre
    }
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

  // Where each day was, coarsely. "unknown" days stay unset — silence is a gap
  // in tracking, never evidence of a day at home (see lib/day-location).
  const home = estimateHome(locPoints.points, tz)
  for (const dl of summariseDays(locPoints.points, tz, home)) {
    if (dl.date < since60str) continue
    const d = getOrCreate(dl.date)
    if (dl.presence !== "unknown") d.presence = dl.presence
    if (dl.slept !== "unknown") d.sleptAway = dl.slept === "away"
  }

  // Walking minutes — but only on days movement recognition was running at
  // all. A tracked day without a walk span is a genuine 0; an untracked day
  // is unknown and stays out of both groups.
  const walkByDay = new Map<string, number>()
  const movementTracked = new Set<string>()
  for (const s of travelSpans) {
    const dateStr = localDay(s.start)
    if (dateStr < since60str) continue
    movementTracked.add(dateStr)
    if (s.mode === "walk") {
      walkByDay.set(dateStr, (walkByDay.get(dateStr) ?? 0) + Math.max(0, (s.end.getTime() - s.start.getTime()) / 60_000))
    }
  }
  for (const dateStr of movementTracked) {
    getOrCreate(dateStr).walkMin = Math.round(walkByDay.get(dateStr) ?? 0)
  }

  for (const r of rescueRows) {
    const d = getOrCreate(r.date)
    if (r.productiveH != null) d.productiveH = r.productiveH
    if (r.distractingH != null) d.distractingH = r.distractingH
  }

  // Blood pressure: a day's average systolic. Multiple readings a day are
  // common (morning + evening cuffs) and averaging beats picking one.
  const bpAgg = new Map<string, { sum: number; n: number }>()
  for (const b of bpRows) {
    const dateStr = localDay(b.loggedAt)
    const a = bpAgg.get(dateStr) ?? { sum: 0, n: 0 }
    a.sum += b.systolic
    a.n += 1
    bpAgg.set(dateStr, a)
  }
  for (const [dateStr, a] of bpAgg) {
    getOrCreate(dateStr).systolic = Math.round(a.sum / a.n)
  }

  const allDays = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totalDays = allDays.length

  // The whole insight battery, runnable on any subset of days — it runs twice:
  // once on everything, once on weekdays only (the weekend confounder guard).
  // Custom-tracker group definitions come from the FULL window, not from
  // whichever day-subset a pass happens to see: recomputing the median (or
  // the binary detection) on weekdays-only would make the weekend guard
  // compare two structurally different splits, and re-applying the 10-day
  // gate on the smaller weekday set would silently skip the guard for
  // exactly the weekend-clustered trackers it exists to catch. Qualification
  // happens here; inside each pass compareGroups' per-group minimums decide,
  // same as every built-in source.
  const customDefs = customMetricRows.flatMap(metric => {
    const vals = allDays.filter(d => d.custom?.[metric.id] != null).map(d => d.custom![metric.id])
    if (vals.length < 10) return []
    const isBinary = metric.type === "boolean" || vals.every(v => v === 0 || v === 1)
    const valMedian = median(vals)
    return [{
      id: metric.id,
      name: metric.name,
      emoji: metric.emoji,
      isHigh: (v: number) => (isBinary ? v >= 1 : v >= valMedian),
      highLabel: isBinary ? `${metric.name} days` : `higher ${metric.name} days (${r1(valMedian)}+)`,
      lowLabel: isBinary ? `days without ${metric.name}` : `lower ${metric.name} days`,
    }]
  })

  const deriveInsights = (days: DayData[]): InsightResult[] => {
  const insights: InsightResult[] = []
  const byDate = Object.fromEntries(days.map(d => [d.date, d]))

  // Oura's sleep record dated D is the night that ENDED on morning D — the
  // record, its resting HR, its deep/REM minutes, and the readiness derived
  // from it all describe the night before day D. So for anything that
  // happened DURING day D (a coffee, a workout, a stressful afternoon, an
  // evening of screens), "that night's sleep" is the record dated D+1. Ten
  // families used to read the record dated D instead, which scored the
  // afternoon coffee against the sleep that had already happened.
  const tonight = (d: DayData): DayData | undefined => byDate[nextDateStr(d.date)]

  // 1. Sleep duration → next-day energy / mood
  const sleepDurHighEnergy: number[] = []
  const sleepDurLowEnergy: number[] = []
  const sleepDurHighMood: number[] = []
  const sleepDurLowMood: number[] = []
  // The check-in dated D is the morning that the sleep record dated D ended
  // on — the same morning, not the next one. Reading the check-in from D+1
  // compared each night with how the user felt after the FOLLOWING night.
  for (const d of days) {
    if (d.sleepDuration == null) continue
    const isHigh = d.sleepDuration >= 7
    if (d.energy != null) { if (isHigh) sleepDurHighEnergy.push(d.energy); else sleepDurLowEnergy.push(d.energy) }
    if (d.mood != null) { if (isHigh) sleepDurHighMood.push(d.mood); else sleepDurLowMood.push(d.mood) }
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
    const isHigh = d.sleepScore >= 80
    if (d.energy != null) { if (isHigh) sleepScoreHighEnergy.push(d.energy); else sleepScoreLowEnergy.push(d.energy) }
    if (d.mood != null) { if (isHigh) sleepScoreHighMood.push(d.mood); else sleepScoreLowMood.push(d.mood) }
  }
  const ins_sleepScore_energy = compareGroups({
    id: "sleep_score_energy", category: "sleep", emoji: "⚡", title: "Sleep Score & Morning Energy",
    highGroupLabel: "80+ sleep score nights", lowGroupLabel: "below 80 sleep score nights",
    highValues: sleepScoreHighEnergy, lowValues: sleepScoreLowEnergy,
    findingTemplate: (h, l) => `On high sleep score nights (80+), morning energy averages ${h} vs ${l}`,
  })
  if (ins_sleepScore_energy) insights.push(ins_sleepScore_energy)
  const ins_sleepScore_mood = compareGroups({
    id: "sleep_score_mood", category: "sleep", emoji: "🌟", title: "Sleep Score & Morning Mood",
    highGroupLabel: "80+ sleep score nights", lowGroupLabel: "below 80 sleep score nights",
    highValues: sleepScoreHighMood, lowValues: sleepScoreLowMood,
    findingTemplate: (h, l) => `On high sleep score nights (80+), morning mood averages ${h} vs ${l}`,
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
    const next = tonight(d)
    if (next?.sleepScore != null) { if (isHigh) stressHighSleep.push(next.sleepScore); else stressLowSleep.push(next.sleepScore) }
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
    const night = tonight(d)
    if (d.caffeineMg == null || night?.sleepScore == null) continue
    if (d.caffeineMg >= 200) caffeineHighSleep.push(night.sleepScore)
    else caffeineLowSleep.push(night.sleepScore)
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
    // Resting HR on record D was measured during the night record D
    // describes — the same night as its sleep duration, not the one after.
    if (d.sleepDuration != null && d.restingHR != null) {
      if (d.sleepDuration >= 7) sleepRhrHigh.push(d.restingHR)
      else sleepRhrLow.push(d.restingHR)
    }
    const next = tonight(d)
    if (!next || next.restingHR == null) continue
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
    const next = tonight(d)
    if (next?.sleepScore != null) { if (isActive) activeSleepHigh.push(next.sleepScore); else activeSleepLow.push(next.sleepScore) }
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
      const next = tonight(d)
      if (next?.sleepScore != null) { if (isRainy) rainSleep.push(next.sleepScore); else noRainSleep.push(next.sleepScore) }
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
      const next = tonight(d)
      if (next?.sleepScore != null) { if (isHigh) screenSleepHigh.push(next.sleepScore); else screenSleepLow.push(next.sleepScore) }
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
      if (d.eventCount == null && !calendarCovers(d.date)) continue // unknown, not quiet
      const load = d.eventCount ?? 0
      const isBusy = load >= loadMedian && load > 0
      const next = tonight(d)
      if (next?.sleepScore != null) { if (isBusy) busySleep.push(next.sleepScore); else quietSleep.push(next.sleepScore) }
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

  // Presence isn't binary for anything with a long half-life. Elicea sits at
  // ~30 h and Mirzaten ~26 h, so the night after one missed dose still has
  // most of the drug on board — calling that an "off" day compares a
  // three-quarters-medicated night against a fully-medicated one and finds
  // nothing. Where the half-life is known, days are scored by how much is
  // estimated to still be circulating (a dose decayed across the preceding
  // days) and split at the median, which turns a real multi-day gap into a
  // genuine off-period and leaves single misses where they belong: mostly on.
  // Substances without a meaningful single half-life — vitamin D, omega-3,
  // anything stored — keep the honest binary comparison.
  const RESIDUAL_LOOKBACK_DAYS = 10
  const NEGLIGIBLE_LEVEL = 0.15 // in dose-units; below this it's effectively gone

  function residualLevels(supp: string, halfLifeH: number): number[] {
    return days.map((_, i) => {
      let level = 0
      for (let back = 0; back <= RESIDUAL_LOOKBACK_DAYS && i - back >= 0; back++) {
        if ((days[i - back].supplements ?? []).includes(supp)) {
          level += Math.pow(0.5, (back * 24) / halfLifeH)
        }
      }
      return level
    })
  }

  for (const supp of topSupps) {
    const halfLifeH = supplementInfoFor(supp)?.halfLifeH
    let onBoard: (dayIndex: number) => boolean = () => false
    let highLabel = `${supp} days`
    let lowLabel = `days without ${supp}`
    let levelBased = false

    if (halfLifeH) {
      const levels = residualLevels(supp, halfLifeH)
      const sorted = [...levels].sort((a, b) => a - b)
      const lowQ = sorted[Math.floor(sorted.length * 0.25)]
      const highQ = sorted[Math.floor(sorted.length * 0.75)]
      // Only worth doing when the level actually varies — someone with perfect
      // adherence has no off-period to compare against, and splitting a flat
      // line at its median just manufactures two identical groups.
      if (highQ > Math.max(lowQ * 1.5, NEGLIGIBLE_LEVEL)) {
        const cut = Math.max(median(levels), NEGLIGIBLE_LEVEL)
        onBoard = i => levels[i] >= cut
        highLabel = `${supp} still on board`
        lowLabel = `after it cleared`
        levelBased = true
      }
    }
    if (!levelBased) {
      onBoard = i => (days[i].supplements ?? []).includes(supp)
    }

    const withSleep: number[] = [], withoutSleep: number[] = []
    const withHrv: number[] = [], withoutHrv: number[] = []
    const withDeep: number[] = [], withoutDeep: number[] = []
    const withRem: number[] = [], withoutRem: number[] = []
    for (let i = 0; i < days.length; i++) {
      const d = days[i]
      const took = onBoard(i)
      const next = byDate[nextDateStr(d.date)]
      if (!next) continue
      if (next.sleepScore != null) { if (took) withSleep.push(next.sleepScore); else withoutSleep.push(next.sleepScore) }
      if (next.hrv != null) { if (took) withHrv.push(next.hrv); else withoutHrv.push(next.hrv) }
      if (next.deepSleepMin != null) { if (took) withDeep.push(next.deepSleepMin); else withoutDeep.push(next.deepSleepMin) }
      if (next.remSleepMin != null) { if (took) withRem.push(next.remSleepMin); else withoutRem.push(next.remSleepMin) }
    }
    const ins_supp_sleep = compareGroups({
      id: `supplement_${suppSlug(supp)}_sleep`, category: "supplements", emoji: "💊", title: `${supp} & Sleep Quality`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      highValues: withSleep, lowValues: withoutSleep,
      findingTemplate: (h, l) =>
        h > l
          ? `${levelBased ? `While ${supp} was still circulating` : `On nights after taking ${supp}`}, sleep score averages ${h} vs ${l} ${levelBased ? "once it cleared" : "without it"}`
          : `${supp} doesn't show a sleep benefit yet — ${h} vs ${l} ${levelBased ? "once it cleared" : "without it"}`,
    })
    if (ins_supp_sleep) insights.push(ins_supp_sleep)
    const ins_supp_hrv = compareGroups({
      id: `supplement_${suppSlug(supp)}_hrv`, category: "supplements", emoji: "💓", title: `${supp} & HRV`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      highValues: withHrv, lowValues: withoutHrv,
      findingTemplate: (h, l) =>
        h > l
          ? `Mornings after ${supp}, HRV averages ${h}ms vs ${l}ms without it`
          : `${supp} doesn't move your HRV — ${h}ms vs ${l}ms without it`,
    })
    if (ins_supp_hrv) insights.push(ins_supp_hrv)

    // Sleep architecture, not just the score. Sedatives are the reason this
    // matters: several of them buy sleep *time* while cutting deep and REM,
    // so a night can feel fine, score fine, and still leave the restorative
    // stages short. The stage minutes are the only place that shows up.
    const ins_supp_deep = compareGroups({
      id: `supplement_${suppSlug(supp)}_deep`, category: "supplements", emoji: "🌊", title: `${supp} & Deep Sleep`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      highValues: withDeep, lowValues: withoutDeep,
      findingTemplate: (h, l) =>
        h > l
          ? `Nights after ${supp}, deep sleep averages ${Math.round(h)}min vs ${Math.round(l)}min without it`
          : `Nights after ${supp}, deep sleep drops to ${Math.round(h)}min vs ${Math.round(l)}min without it`,
    })
    if (ins_supp_deep) insights.push(ins_supp_deep)
    const ins_supp_rem = compareGroups({
      id: `supplement_${suppSlug(supp)}_rem`, category: "supplements", emoji: "🌀", title: `${supp} & REM Sleep`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      highValues: withRem, lowValues: withoutRem,
      findingTemplate: (h, l) =>
        h > l
          ? `Nights after ${supp}, REM averages ${Math.round(h)}min vs ${Math.round(l)}min without it`
          : `Nights after ${supp}, REM drops to ${Math.round(h)}min vs ${Math.round(l)}min without it`,
    })
    if (ins_supp_rem) insights.push(ins_supp_rem)
  }

  // 15b. Interactions — the same substance on a drinking day vs a sober one.
  // Every other section compares "did X vs didn't"; this asks whether X lands
  // differently depending on what else was on board. Sedatives and alcohol are
  // the case that matters: both suppress the restorative stages, and the
  // pharmacology text can warn about it but only the user's own nights can
  // show it. Restricted to the three most-logged substances, and every cell
  // still has to clear the 5-day minimum, so it stays quiet until there's
  // genuinely enough overlap.
  const MODIFIERS: { key: string; label: string; test: (d: DayData) => boolean }[] = [
    { key: "alcohol",  label: "alcohol",          test: d => (d.alcoholMl ?? 0) > 50 },
    { key: "caffeine", label: "200mg+ caffeine",  test: d => (d.caffeineMg ?? 0) >= 200 },
  ]
  for (const supp of topSupps.slice(0, 3)) {
    for (const mod of MODIFIERS) {
      const bothSleep: number[] = [], soloSleep: number[] = []
      const bothDeep: number[] = [], soloDeep: number[] = []
      for (const d of days) {
        if (!(d.supplements ?? []).includes(supp)) continue // only that substance's days
        const next = byDate[nextDateStr(d.date)]
        if (!next) continue
        const alsoHad = mod.test(d)
        if (next.sleepScore != null) { (alsoHad ? bothSleep : soloSleep).push(next.sleepScore) }
        if (next.deepSleepMin != null) { (alsoHad ? bothDeep : soloDeep).push(next.deepSleepMin) }
      }
      const ins_int_sleep = compareGroups({
        id: `interaction_${suppSlug(supp)}_${mod.key}_sleep`, category: "interactions", emoji: "🔀",
        title: `${supp} + ${mod.label} & Sleep`,
        highGroupLabel: `${supp} + ${mod.label}`, lowGroupLabel: `${supp} alone`,
        highValues: bothSleep, lowValues: soloSleep,
        findingTemplate: (h, l) =>
          h < l
            ? `On ${supp} nights that also involved ${mod.label}, sleep score averages ${h} vs ${l} on ${supp} nights without it`
            : `${mod.label} on top of ${supp} doesn't cost you sleep score — ${h} vs ${l}`,
      })
      if (ins_int_sleep) insights.push(ins_int_sleep)
      const ins_int_deep = compareGroups({
        id: `interaction_${suppSlug(supp)}_${mod.key}_deep`, category: "interactions", emoji: "🌊",
        title: `${supp} + ${mod.label} & Deep Sleep`,
        highGroupLabel: `${supp} + ${mod.label}`, lowGroupLabel: `${supp} alone`,
        highValues: bothDeep, lowValues: soloDeep,
        findingTemplate: (h, l) =>
          h < l
            ? `${supp} plus ${mod.label} leaves ${Math.round(h)}min of deep sleep vs ${Math.round(l)}min on ${supp} alone`
            : `Adding ${mod.label} to ${supp} doesn't cut your deep sleep — ${Math.round(h)}min vs ${Math.round(l)}min`,
      })
      if (ins_int_deep) insights.push(ins_int_deep)
    }
  }

  // 15c. Symptoms — the only section where the thing being explained is how the
  // user *felt* rather than what their body scored. Runs the other way round to
  // everything above: each symptom is the outcome, and the factors are the
  // suspects. A day with no entry for a symptom is a genuine zero, not missing
  // data — that's what makes "headache severity on drinking days vs sober days"
  // a fair comparison rather than one computed only over days it hurt.
  const symptomDayCount = new Map<string, number>()
  for (const d of days) {
    for (const name of Object.keys(d.symptoms ?? {})) {
      symptomDayCount.set(name, (symptomDayCount.get(name) ?? 0) + 1)
    }
  }
  const topSymptoms = [...symptomDayCount.entries()]
    .filter(([, n]) => n >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([s]) => s)

  if (topSymptoms.length > 0) {
    // Suspects worth testing. Sleep and alcohol look at the *previous* day —
    // a hangover headache belongs to last night's drinking, not this morning's.
    const SUSPECTS: { key: string; label: string; test: (d: DayData, prev?: DayData) => boolean | null }[] = [
      { key: "alcohol", label: "the day after drinking", test: (_d, prev) => prev ? (prev.alcoholMl ?? 0) > 50 : null },
      { key: "caffeine", label: "200mg+ caffeine days", test: d => d.caffeineMg != null ? d.caffeineMg >= 200 : null },
      { key: "short_sleep", label: "after under 7h sleep", test: d => d.sleepDuration != null ? d.sleepDuration < 7 : null },
      { key: "poor_sleep", label: "after a sub-70 sleep score", test: d => d.sleepScore != null ? d.sleepScore < 70 : null },
      { key: "late_meal", label: "the day after a late dinner", test: (_d, prev) => prev?.lastMealMin != null ? prev.lastMealMin >= 20 * 60 : null },
      { key: "high_screen", label: "the day after heavy screen time", test: (_d, prev) => prev?.screenTimeMin != null ? prev.screenTimeMin >= 300 : null },
      { key: "workout", label: "the day after training", test: (_d, prev) => prev ? (prev.workoutMin ?? 0) >= 20 : null },
      { key: "low_water", label: "the day after under 1.5L water", test: (_d, prev) => prev?.waterMl != null ? prev.waterMl < 1500 : null },
    ]

    const prevDateStr = (dateStr: string): string => {
      const dt = new Date(dateStr + "T12:00:00Z")
      dt.setUTCDate(dt.getUTCDate() - 1)
      return dt.toISOString().slice(0, 10)
    }

    for (const symptom of topSymptoms) {
      const symSlug = suppSlug(symptom)
      for (const suspect of SUSPECTS) {
        const exposed: number[] = [], notExposed: number[] = []
        for (const d of days) {
          const prev = byDate[prevDateStr(d.date)]
          const verdict = suspect.test(d, prev)
          if (verdict == null) continue // that factor wasn't recorded — not a zero
          const severity = d.symptoms?.[symptom] ?? 0
          if (verdict) exposed.push(severity); else notExposed.push(severity)
        }
        const ins_symptom = compareGroups({
          id: `symptom_${symSlug}_${suspect.key}`, category: "symptoms", emoji: "🩹",
          title: `${symptom} & ${suspect.label.replace(/^(the day )?after /, "").replace(/ days$/, "")}`,
          highGroupLabel: suspect.label, lowGroupLabel: "other days",
          highValues: exposed, lowValues: notExposed,
          higherIsBetter: false, // more symptom is worse, so a rise reads as negative
          findingTemplate: (h, l) =>
            h > l
              ? `${symptom} runs at ${h}/5 ${suspect.label}, vs ${l}/5 otherwise`
              : `${suspect.label.charAt(0).toUpperCase() + suspect.label.slice(1)} don't bring more ${symptom.toLowerCase()} — ${h}/5 vs ${l}/5`,
        })
        if (ins_symptom) insights.push(ins_symptom)
      }

      // Meds are suspects too — this is the side-effect question, and it's the
      // reason symptom tracking earns its place next to the pharmacology work.
      for (const supp of topSupps.slice(0, 3)) {
        const onDays: number[] = [], offDays: number[] = []
        for (const d of days) {
          const took = (d.supplements ?? []).includes(supp)
          const severity = d.symptoms?.[symptom] ?? 0
          if (took) onDays.push(severity); else offDays.push(severity)
        }
        const ins_symptom_med = compareGroups({
          id: `symptom_${symSlug}_med_${suppSlug(supp)}`, category: "symptoms", emoji: "💊",
          title: `${symptom} & ${supp}`,
          highGroupLabel: `${supp} days`, lowGroupLabel: `days without it`,
          highValues: onDays, lowValues: offDays,
          higherIsBetter: false,
          findingTemplate: (h, l) =>
            h > l
              ? `On ${supp} days, ${symptom.toLowerCase()} averages ${h}/5 vs ${l}/5 without it`
              : `${symptom} is no worse on ${supp} days — ${h}/5 vs ${l}/5`,
        })
        if (ins_symptom_med) insights.push(ins_symptom_med)
      }
    }
  }

  // 16. Workouts (Strava) — the classic wearable questions: does training help
  // you sleep, and what does it cost (or pay) in next-day recovery?
  const workoutSleep: number[] = [], restSleep: number[] = []
  const workoutReadiness: number[] = [], restReadiness: number[] = []
  const workoutHrv: number[] = [], restHrv: number[] = []
  for (const d of days) {
    const trained = (d.workoutMin ?? 0) >= 20
    const next = tonight(d)
    if (!next) continue
    if (next.sleepScore != null) { if (trained) workoutSleep.push(next.sleepScore); else restSleep.push(next.sleepScore) }
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
      const night = tonight(d)
      if (night?.sleepScore != null) { if (isHigh) musicSleepHigh.push(night.sleepScore); else musicSleepLow.push(night.sleepScore) }
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

  // 17b. Late-night listening → the night that follows.
  //
  // The other three music insights split on how MUCH was played, which is a
  // daytime fact. This one is about WHEN: scrobbles after 22:00 belong to the
  // night, and the night is the thing sleep is measured over. Compared against
  // the NEXT day's numbers, because a night is reported on the morning it ends.
  //
  // Days with one to four late tracks are deliberately in neither group — a
  // couple of songs while brushing your teeth is not a late night, and lumping
  // them either way is what turns a real effect into noise.
  const lateDays = days.filter(d => d.lateTracks != null)
  if (lateDays.length >= 10) {
    const lateSleepHigh: number[] = [], lateSleepLow: number[] = []
    const lateDurHigh: number[] = [], lateDurLow: number[] = []
    const lateReadyHigh: number[] = [], lateReadyLow: number[] = []
    for (const d of lateDays) {
      const late = d.lateTracks as number
      if (late > 0 && late < 5) continue
      const isLate = late >= 5
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (isLate) lateSleepHigh.push(next.sleepScore); else lateSleepLow.push(next.sleepScore) }
      if (next?.sleepDuration != null) { if (isLate) lateDurHigh.push(next.sleepDuration); else lateDurLow.push(next.sleepDuration) }
      if (next?.readiness != null) { if (isLate) lateReadyHigh.push(next.readiness); else lateReadyLow.push(next.readiness) }
    }
    const ins_late_music_sleep = compareGroups({
      id: "late_music_sleep", category: "music", emoji: "🌙", title: "Late-night music & sleep",
      highGroupLabel: "nights you listened past 22:00", lowGroupLabel: "quiet evenings",
      highValues: lateSleepHigh, lowValues: lateSleepLow,
      findingTemplate: (h, l) =>
        h < l
          ? `After evenings with music past 22:00, sleep scores ${h} vs ${l} after quiet ones`
          : `Music past 22:00 doesn't cost you sleep quality — ${h} vs ${l}`,
    })
    if (ins_late_music_sleep) insights.push(ins_late_music_sleep)
    const ins_late_music_dur = compareGroups({
      id: "late_music_duration", category: "music", emoji: "🎧", title: "Late-night music & sleep length",
      highGroupLabel: "nights you listened past 22:00", lowGroupLabel: "quiet evenings",
      highValues: lateDurHigh, lowValues: lateDurLow,
      findingTemplate: (h, l) =>
        h < l
          ? `You sleep ${h}h after listening past 22:00, against ${l}h after quiet evenings`
          : `Listening past 22:00 goes with ${h}h of sleep, against ${l}h after quiet evenings`,
    })
    if (ins_late_music_dur) insights.push(ins_late_music_dur)
    const ins_late_music_ready = compareGroups({
      id: "late_music_readiness", category: "music", emoji: "🔋", title: "Late-night music & next-day readiness",
      highGroupLabel: "mornings after late listening", lowGroupLabel: "mornings after quiet evenings",
      highValues: lateReadyHigh, lowValues: lateReadyLow,
      findingTemplate: (h, l) =>
        h < l
          ? `Readiness comes in at ${h} after a late-listening evening, ${l} otherwise`
          : `Readiness holds at ${h} after late listening, against ${l} otherwise`,
    })
    if (ins_late_music_ready) insights.push(ins_late_music_ready)
  }

  // 17c. Genre — not how much music, but what KIND. Each day is labelled with
  // its top artist's genre (community tags via ArtistGenre), and the user's
  // own most-common genres are auto-discovered, like calendar activities and
  // supplements are. Compared against OTHER listening days, never against
  // silent ones — otherwise every genre would just rediscover "listened at
  // all", which the volume insights above already test.
  const genreDayCount = new Map<string, number>()
  for (const d of days) {
    if (d.musicGenre) genreDayCount.set(d.musicGenre, (genreDayCount.get(d.musicGenre) ?? 0) + 1)
  }
  const topGenres = [...genreDayCount.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([g]) => g)
  for (const genre of topGenres) {
    const gSlug = suppSlug(genre)
    const gMood: number[] = [], otherMood: number[] = []
    const gSleep: number[] = [], otherSleep: number[] = []
    for (const d of days) {
      if (d.listeningMin == null || d.musicGenre == null) continue
      const hit = d.musicGenre === genre
      if (d.mood != null) { if (hit) gMood.push(d.mood); else otherMood.push(d.mood) }
      const night = tonight(d)
      if (night?.sleepScore != null) { if (hit) gSleep.push(night.sleepScore); else otherSleep.push(night.sleepScore) }
    }
    const ins_genre_mood = compareGroups({
      id: `music_genre_${gSlug}_mood`, category: "music", emoji: "🎼", title: `${genre} days & Mood`,
      highGroupLabel: `days topped by ${genre}`, lowGroupLabel: "other listening days",
      highValues: gMood, lowValues: otherMood,
      findingTemplate: (h, l) =>
        h > l
          ? `On days your listening leans ${genre}, mood averages ${h} vs ${l} on other music days`
          : `${genre} days run a mood of ${h} vs ${l} on other music days`,
    })
    if (ins_genre_mood) insights.push(ins_genre_mood)
    const ins_genre_sleep = compareGroups({
      id: `music_genre_${gSlug}_sleep`, category: "music", emoji: "🎚️", title: `${genre} days & Sleep`,
      highGroupLabel: `days topped by ${genre}`, lowGroupLabel: "other listening days",
      highValues: gSleep, lowValues: otherSleep,
      findingTemplate: (h, l) =>
        h > l
          ? `On ${genre} days, sleep score averages ${h} vs ${l} on other music days`
          : `${genre} days link to a sleep score of ${h} vs ${l} on other music days`,
    })
    if (ins_genre_sleep) insights.push(ins_genre_sleep)
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
    const next = tonight(d)
    if (d.caffeineMg != null && next?.deepSleepMin != null) {
      if (d.caffeineMg >= 200) caffeineDeepHigh.push(next.deepSleepMin)
      else caffeineDeepLow.push(next.deepSleepMin)
    }
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

  // 23. Places — the coarse GPS day-facts, finally in the same battery as
  // everything else (per-place comparisons stay on the Insights page's own
  // "By place" section; these are the whole-day facts with the full
  // permutation + FDR treatment).
  //
  // slept joins to the SAME day's sleep record — both describe the night that
  // ended that morning. presence describes the waking day, so its sleep
  // consequence is the night that follows (the next day's record).
  const sleptAwaySleep: number[] = [], sleptHomeSleep: number[] = []
  const sleptAwayDur: number[] = [], sleptHomeDur: number[] = []
  const awayDayMood: number[] = [], townDayMood: number[] = []
  const awayDaySleep: number[] = [], townDaySleep: number[] = []
  for (const d of days) {
    if (d.sleptAway != null) {
      if (d.sleepScore != null) { if (d.sleptAway) sleptAwaySleep.push(d.sleepScore); else sleptHomeSleep.push(d.sleepScore) }
      if (d.sleepDuration != null) { if (d.sleptAway) sleptAwayDur.push(d.sleepDuration); else sleptHomeDur.push(d.sleepDuration) }
    }
    if (d.presence != null) {
      const isAway = d.presence === "away"
      if (d.mood != null) { if (isAway) awayDayMood.push(d.mood); else townDayMood.push(d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (isAway) awayDaySleep.push(next.sleepScore); else townDaySleep.push(next.sleepScore) }
    }
  }
  const ins_slept_away = compareGroups({
    id: "slept_away_sleep", category: "places", emoji: "🛏️", title: "Sleeping Away & Sleep Quality",
    highGroupLabel: "nights away from your own bed", lowGroupLabel: "nights at home",
    highValues: sleptAwaySleep, lowValues: sleptHomeSleep,
    findingTemplate: (h, l) =>
      h < l
        ? `Nights away from your own bed score ${h} vs ${l} at home`
        : `You sleep fine away from home — score ${h} vs ${l} in your own bed`,
  })
  if (ins_slept_away) insights.push(ins_slept_away)
  const ins_slept_away_dur = compareGroups({
    id: "slept_away_duration", category: "places", emoji: "⏰", title: "Sleeping Away & Sleep Length",
    highGroupLabel: "nights away from your own bed", lowGroupLabel: "nights at home",
    highValues: sleptAwayDur, lowValues: sleptHomeDur,
    findingTemplate: (h, l) =>
      h < l
        ? `Away from home you sleep ${h}h vs ${l}h in your own bed`
        : `You sleep ${h}h away from home, against ${l}h in your own bed`,
  })
  if (ins_slept_away_dur) insights.push(ins_slept_away_dur)
  const ins_away_mood = compareGroups({
    id: "away_day_mood", category: "places", emoji: "🧳", title: "Days Away & Mood",
    highGroupLabel: `days away from home (${AWAY_KM}km+)`, lowGroupLabel: "days in your own town",
    highValues: awayDayMood, lowValues: townDayMood,
    findingTemplate: (h, l) =>
      h > l
        ? `On days away from home, mood averages ${h} vs ${l} in your own town`
        : `Days away don't lift your mood — ${h} vs ${l} at home`,
  })
  if (ins_away_mood) insights.push(ins_away_mood)
  const ins_away_sleep = compareGroups({
    id: "away_day_sleep", category: "places", emoji: "🗺️", title: "Days Away & That Night's Sleep",
    highGroupLabel: `days away from home (${AWAY_KM}km+)`, lowGroupLabel: "days in your own town",
    highValues: awayDaySleep, lowValues: townDaySleep,
    findingTemplate: (h, l) =>
      h < l
        ? `Nights that end a day away score ${h} vs ${l} after ordinary days`
        : `Travel days don't cost you sleep — ${h} vs ${l} after ordinary days`,
  })
  if (ins_away_sleep) insights.push(ins_away_sleep)

  // 23b. Walking — recognised walking minutes, not steps: this is time actually
  // spent moving through the world, and it exists for imported history too.
  const walkVals = days.filter(d => d.walkMin != null).map(d => d.walkMin!)
  if (walkVals.length >= 10) {
    const walkMedian = median(walkVals)
    const fmtWalk = walkMedian >= 60 ? `${(walkMedian / 60).toFixed(1)}h` : `${Math.round(walkMedian)}min`
    const walkMoodHigh: number[] = [], walkMoodLow: number[] = []
    const walkSleepHigh: number[] = [], walkSleepLow: number[] = []
    for (const d of days) {
      if (d.walkMin == null) continue
      const isHigh = d.walkMin >= walkMedian
      if (d.mood != null) { if (isHigh) walkMoodHigh.push(d.mood); else walkMoodLow.push(d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (isHigh) walkSleepHigh.push(next.sleepScore); else walkSleepLow.push(next.sleepScore) }
    }
    const ins_walk_mood = compareGroups({
      id: "walking_mood", category: "places", emoji: "🚶", title: "Walking & Mood",
      highGroupLabel: `bigger walking days (${fmtWalk}+)`, lowGroupLabel: "less-walked days",
      highValues: walkMoodHigh, lowValues: walkMoodLow,
      findingTemplate: (h, l) =>
        h > l
          ? `On days you walk ${fmtWalk}+, mood averages ${h} vs ${l} on less-walked days`
          : `Bigger walking days don't show a mood lift — ${h} vs ${l}`,
    })
    if (ins_walk_mood) insights.push(ins_walk_mood)
    const ins_walk_sleep = compareGroups({
      id: "walking_sleep", category: "places", emoji: "🌆", title: "Walking & That Night's Sleep",
      highGroupLabel: `bigger walking days (${fmtWalk}+)`, lowGroupLabel: "less-walked days",
      highValues: walkSleepHigh, lowValues: walkSleepLow,
      findingTemplate: (h, l) =>
        h > l
          ? `Nights after ${fmtWalk}+ of walking score ${h} vs ${l} after stiller days`
          : `Walking more doesn't move your sleep score — ${h} vs ${l}`,
    })
    if (ins_walk_sleep) insights.push(ins_walk_sleep)
  }

  // 24. Work (RescueTime) — synced daily for months and never correlated with
  // anything. Productive hours and distracting hours are separate questions:
  // a deep-work day and a doomscrolling day can have the same screen total.
  const prodVals = days.filter(d => d.productiveH != null).map(d => d.productiveH!)
  if (prodVals.length >= 10) {
    const prodMedian = median(prodVals)
    const prodMoodHigh: number[] = [], prodMoodLow: number[] = []
    const prodSleepHigh: number[] = [], prodSleepLow: number[] = []
    for (const d of days) {
      if (d.productiveH == null) continue
      const isHigh = d.productiveH >= prodMedian
      if (d.mood != null) { if (isHigh) prodMoodHigh.push(d.mood); else prodMoodLow.push(d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (isHigh) prodSleepHigh.push(next.sleepScore); else prodSleepLow.push(next.sleepScore) }
    }
    const ins_prod_mood = compareGroups({
      id: "work_productive_mood", category: "work", emoji: "💼", title: "Productive Hours & Mood",
      highGroupLabel: `${r1(prodMedian)}h+ productive days`, lowGroupLabel: "lighter work days",
      highValues: prodMoodHigh, lowValues: prodMoodLow,
      findingTemplate: (h, l) =>
        h > l
          ? `On ${r1(prodMedian)}h+ productive days, mood averages ${h} vs ${l} on lighter days`
          : `Big work days don't come with better mood — ${h} vs ${l}`,
    })
    if (ins_prod_mood) insights.push(ins_prod_mood)
    const ins_prod_sleep = compareGroups({
      id: "work_productive_sleep", category: "work", emoji: "🌜", title: "Productive Hours & That Night's Sleep",
      highGroupLabel: `${r1(prodMedian)}h+ productive days`, lowGroupLabel: "lighter work days",
      highValues: prodSleepHigh, lowValues: prodSleepLow,
      findingTemplate: (h, l) =>
        h < l
          ? `Nights after ${r1(prodMedian)}h+ of productive work score ${h} vs ${l} after lighter days`
          : `Long productive days don't cost you sleep — ${h} vs ${l}`,
    })
    if (ins_prod_sleep) insights.push(ins_prod_sleep)
  }
  const distVals = days.filter(d => d.distractingH != null).map(d => d.distractingH!)
  if (distVals.length >= 10) {
    const distMedian = median(distVals)
    const distMoodHigh: number[] = [], distMoodLow: number[] = []
    for (const d of days) {
      if (d.distractingH == null || d.mood == null) continue
      if (d.distractingH >= distMedian) distMoodHigh.push(d.mood)
      else distMoodLow.push(d.mood)
    }
    const ins_dist_mood = compareGroups({
      id: "work_distracting_mood", category: "work", emoji: "🕳️", title: "Distracting Hours & Mood",
      highGroupLabel: `${r1(distMedian)}h+ distracted days`, lowGroupLabel: "more focused days",
      highValues: distMoodHigh, lowValues: distMoodLow,
      findingTemplate: (h, l) =>
        h < l
          ? `On ${r1(distMedian)}h+ distracted days, mood averages ${h} vs ${l} on more focused days`
          : `Distracted days don't show up in your mood — ${h} vs ${l}`,
    })
    if (ins_dist_mood) insights.push(ins_dist_mood)
  }

  // 25. Blood pressure — the one log where the OUTCOME is the number itself.
  // Systolic against the classic levers: last night's sleep, yesterday's
  // alcohol, today's caffeine. Only days with a cuff reading count.
  const bpDays = days.filter(d => d.systolic != null)
  if (bpDays.length >= 10) {
    const bpShortSleep: number[] = [], bpGoodSleep: number[] = []
    const bpAfterDrinks: number[] = [], bpSober: number[] = []
    const bpHighCaf: number[] = [], bpLowCaf: number[] = []
    const prevDateStr2 = (dateStr: string): string => {
      const dt = new Date(dateStr + "T12:00:00Z")
      dt.setUTCDate(dt.getUTCDate() - 1)
      return dt.toISOString().slice(0, 10)
    }
    for (const d of bpDays) {
      const sys = d.systolic!
      if (d.sleepDuration != null) { if (d.sleepDuration < 7) bpShortSleep.push(sys); else bpGoodSleep.push(sys) }
      const prev = byDate[prevDateStr2(d.date)]
      if (prev) { if ((prev.alcoholMl ?? 0) > 50) bpAfterDrinks.push(sys); else bpSober.push(sys) }
      if (d.caffeineMg != null) { if (d.caffeineMg >= 200) bpHighCaf.push(sys); else bpLowCaf.push(sys) }
    }
    const ins_bp_sleep = compareGroups({
      id: "bp_short_sleep", category: "heart", emoji: "🩺", title: "Short Sleep & Blood Pressure",
      highGroupLabel: "after under 7h sleep", lowGroupLabel: "after 7h+ sleep",
      highValues: bpShortSleep, lowValues: bpGoodSleep, higherIsBetter: false,
      findingTemplate: (h, l) =>
        h > l
          ? `After short nights, systolic averages ${Math.round(h)} vs ${Math.round(l)} after 7h+ sleep`
          : `Short nights don't raise your systolic — ${Math.round(h)} vs ${Math.round(l)}`,
    })
    if (ins_bp_sleep) insights.push(ins_bp_sleep)
    const ins_bp_alcohol = compareGroups({
      id: "bp_alcohol", category: "heart", emoji: "🍷", title: "Alcohol & Next-Day Blood Pressure",
      highGroupLabel: "the day after drinking", lowGroupLabel: "after sober days",
      highValues: bpAfterDrinks, lowValues: bpSober, higherIsBetter: false,
      findingTemplate: (h, l) =>
        h > l
          ? `The day after drinking, systolic averages ${Math.round(h)} vs ${Math.round(l)} after sober days`
          : `Drinking doesn't show in your next-day systolic — ${Math.round(h)} vs ${Math.round(l)}`,
    })
    if (ins_bp_alcohol) insights.push(ins_bp_alcohol)
    const ins_bp_caffeine = compareGroups({
      id: "bp_caffeine", category: "heart", emoji: "☕", title: "Caffeine & Blood Pressure",
      highGroupLabel: "200mg+ caffeine days", lowGroupLabel: "under 200mg days",
      highValues: bpHighCaf, lowValues: bpLowCaf, higherIsBetter: false,
      findingTemplate: (h, l) =>
        h > l
          ? `On 200mg+ caffeine days, systolic averages ${Math.round(h)} vs ${Math.round(l)} on lighter days`
          : `Caffeine doesn't show in your systolic — ${Math.round(h)} vs ${Math.round(l)}`,
    })
    if (ins_bp_caffeine) insights.push(ins_bp_caffeine)
  }

  // 26. The week itself — weekends vs weekdays, straight from the calendar.
  // Every other family treats the weekend as a CONFOUNDER to guard against;
  // this one asks the plain question directly. Sleep records dated Sat/Sun
  // describe the nights ending those mornings — Friday and Saturday night,
  // which is exactly what "weekend nights" means. This family has no
  // weekday-only twin by construction (that pass has one empty group), so it
  // can never carry its own weekend flag.
  const weSleep: number[] = [], wdSleep: number[] = []
  const weDur: number[] = [], wdDur: number[] = []
  const weMood: number[] = [], wdMood: number[] = []
  const weSteps: number[] = [], wdSteps: number[] = []
  for (const d of days) {
    const we = isWeekendDate(d.date)
    if (d.sleepScore != null) { if (we) weSleep.push(d.sleepScore); else wdSleep.push(d.sleepScore) }
    if (d.sleepDuration != null) { if (we) weDur.push(d.sleepDuration); else wdDur.push(d.sleepDuration) }
    if (d.mood != null) { if (we) weMood.push(d.mood); else wdMood.push(d.mood) }
    if (d.steps != null) { if (we) weSteps.push(d.steps); else wdSteps.push(d.steps) }
  }
  const ins_weekend_sleep = compareGroups({
    id: "weekend_sleep_score", category: "week", emoji: "🛋️", title: "Weekend Nights & Sleep Quality",
    highGroupLabel: "Friday & Saturday nights", lowGroupLabel: "school nights",
    highValues: weSleep, lowValues: wdSleep,
    findingTemplate: (h, l) =>
      h > l
        ? `Friday and Saturday nights score ${h} vs ${l} on school nights`
        : `Weekend nights score ${h} vs ${l} on school nights — the lie-in isn't buying quality`,
  })
  if (ins_weekend_sleep) insights.push(ins_weekend_sleep)
  const ins_weekend_dur = compareGroups({
    id: "weekend_sleep_duration", category: "week", emoji: "⏰", title: "Weekend Nights & Sleep Length",
    highGroupLabel: "Friday & Saturday nights", lowGroupLabel: "school nights",
    highValues: weDur, lowValues: wdDur,
    findingTemplate: (h, l) =>
      h > l
        ? `You sleep ${h}h on weekend nights vs ${l}h on school nights`
        : `Weekend nights run ${h}h vs ${l}h on school nights`,
  })
  if (ins_weekend_dur) insights.push(ins_weekend_dur)
  const ins_weekend_mood = compareGroups({
    id: "weekend_mood", category: "week", emoji: "📆", title: "Weekends & Mood",
    highGroupLabel: "weekend days", lowGroupLabel: "weekdays",
    highValues: weMood, lowValues: wdMood,
    findingTemplate: (h, l) =>
      h > l
        ? `Weekend mood averages ${h} vs ${l} on weekdays`
        : `Weekends don't lift your mood — ${h} vs ${l} on weekdays`,
  })
  if (ins_weekend_mood) insights.push(ins_weekend_mood)
  const ins_weekend_steps = compareGroups({
    id: "weekend_steps", category: "week", emoji: "🚶", title: "Weekends & Movement",
    highGroupLabel: "weekend days", lowGroupLabel: "weekdays",
    highValues: weSteps, lowValues: wdSteps,
    findingTemplate: (h, l) =>
      h > l
        ? `You walk ${Math.round(h).toLocaleString()} steps on weekends vs ${Math.round(l).toLocaleString()} on weekdays`
        : `Weekdays move you more — ${Math.round(l).toLocaleString()} steps vs ${Math.round(h).toLocaleString()} on weekends`,
  })
  if (ins_weekend_steps) insights.push(ins_weekend_steps)

  // 22. Custom trackers — the one family the retired Pearson card on Trends
  // had that this engine didn't. Same treatment as every built-in source:
  // group split (did/didn't for boolean trackers, personal-median otherwise —
  // see customDefs above), permutation test, FDR across the run. Only logged
  // days count (an unlogged day is unknown, not zero), and the targets are
  // fixed up front — mood that day, sleep that night, next-morning energy —
  // instead of cherry-picking whichever pairing happens to score highest.
  for (const metric of customDefs) {
    const logged = days.filter(d => d.custom?.[metric.id] != null)
    const { isHigh, highLabel, lowLabel } = metric

    const cMoodHigh: number[] = [], cMoodLow: number[] = []
    const cSleepHigh: number[] = [], cSleepLow: number[] = []
    const cEnergyHigh: number[] = [], cEnergyLow: number[] = []
    for (const d of logged) {
      const high = isHigh(d.custom![metric.id])
      if (d.mood != null) { if (high) cMoodHigh.push(d.mood); else cMoodLow.push(d.mood) }
      const next = byDate[nextDateStr(d.date)]
      if (next?.sleepScore != null) { if (high) cSleepHigh.push(next.sleepScore); else cSleepLow.push(next.sleepScore) }
      if (next?.energy != null) { if (high) cEnergyHigh.push(next.energy); else cEnergyLow.push(next.energy) }
    }

    const ins_custom_mood = compareGroups({
      id: `custom_${metric.id}_mood`, category: "custom", emoji: metric.emoji, title: `${metric.name} & Mood`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      highValues: cMoodHigh, lowValues: cMoodLow,
      findingTemplate: (h, l) =>
        h > l
          ? `On ${highLabel}, your mood averages ${h} vs ${l} on ${lowLabel}`
          : `On ${highLabel}, mood runs ${h} vs ${l} on ${lowLabel}`,
    })
    if (ins_custom_mood) insights.push(ins_custom_mood)

    const ins_custom_sleep = compareGroups({
      id: `custom_${metric.id}_sleep`, category: "custom", emoji: metric.emoji, title: `${metric.name} & Sleep`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      highValues: cSleepHigh, lowValues: cSleepLow,
      findingTemplate: (h, l) =>
        h > l
          ? `Nights after ${highLabel}, sleep score averages ${h} vs ${l}`
          : `Nights after ${highLabel}, sleep score runs ${h} vs ${l}`,
    })
    if (ins_custom_sleep) insights.push(ins_custom_sleep)

    const ins_custom_energy = compareGroups({
      id: `custom_${metric.id}_energy`, category: "custom", emoji: metric.emoji, title: `${metric.name} & Next-Day Energy`,
      highGroupLabel: highLabel, lowGroupLabel: lowLabel,
      highValues: cEnergyHigh, lowValues: cEnergyLow,
      findingTemplate: (h, l) =>
        h > l
          ? `The morning after ${highLabel}, energy averages ${h} vs ${l}`
          : `The morning after ${highLabel}, energy runs ${h} vs ${l}`,
    })
    if (ins_custom_energy) insights.push(ins_custom_energy)
  }

  return insights
  } // end deriveInsights

  const insights = deriveInsights(allDays)
  assignTiers(insights)

  // Weekend guard: alcohol, late meals, spending, music and screen time all
  // cluster on weekends — and so does sleeping in. An effect that collapses or
  // flips once weekends are excluded is probably the weekend, not the habit.
  permutationsOn = false
  let weekdayVersions: Map<string, InsightResult>
  try {
    weekdayVersions = new Map(
      deriveInsights(allDays.filter(d => !isWeekendDate(d.date))).map(i => [i.id, i]),
    )
  } finally {
    permutationsOn = true
  }
  for (const ins of insights) {
    const wk = weekdayVersions.get(ins.id)
    // A handful of weekdays a side cannot call a collapse: with five values
    // per group, a 35% shrink is what shuffling the same numbers produces.
    // The flag claims "the weekend explains this", so it needs a footing of
    // its own — eight per group keeps it reachable on a 30-day window.
    if (!wk || wk.highGroupN < 8 || wk.lowGroupN < 8) continue
    if (Math.sign(wk.delta) !== Math.sign(ins.delta) || Math.abs(wk.delta) < Math.abs(ins.delta) * 0.35) {
      ins.weekendDriven = true
      // The weekday-only number was always computed and thrown away; keeping
      // it lets the card show how much of the effect the weekend was.
      ins.weekdayDelta = wk.delta
    }
  }

  insights.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return { insights, totalDays }
}
