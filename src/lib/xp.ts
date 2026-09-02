import { prisma } from "@/lib/prisma"
import { getUserTimezone, userToday } from "@/lib/user-timezone"

export const LEVEL_THRESHOLDS = [0, 100, 250, 500, 900, 1500, 2500, 4000, 6000, 9000, 13000]

const LEVEL_NAMES  = ["Seed", "Sprout", "Plant", "Bush", "Flower", "Tree", "Forest", "Grove", "Garden", "Eden", "Paradise"]
const LEVEL_EMOJIS = ["🌱", "🌿", "🍃", "🌺", "🌸", "🌳", "🌲", "🏡", "🌷", "🌍", "✨"]

export interface LevelInfo {
  level: number
  levelName: string
  levelEmoji: string
  minXp: number
  nextXp: number
  progress: number
  xpInLevel: number
  xpToNext: number
}

export function getLevel(xp: number): LevelInfo {
  let level = 1
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1
    else break
  }
  const idx    = Math.min(level - 1, LEVEL_THRESHOLDS.length - 1)
  const floor  = LEVEL_THRESHOLDS[idx] ?? 0
  const ceil   = LEVEL_THRESHOLDS[idx + 1] ?? floor + 5000
  const xpInLevel = xp - floor
  const xpToNext  = Math.max(0, ceil - xp)
  const progress  = Math.min(100, Math.round((xpInLevel / (ceil - floor)) * 100))
  return {
    level,
    levelName:  LEVEL_NAMES[idx]  ?? "Master",
    levelEmoji: LEVEL_EMOJIS[idx] ?? "✨",
    minXp: floor,
    nextXp: ceil,
    progress,
    xpInLevel,
    xpToNext,
  }
}

// ─── GitHub commit XP ─────────────────────────────────────────────────────────
// This used to live only inside /api/streaks (its own inline XP formula), so
// the garden and streaks pages disagreed on the user's level: streaks counted
// GitHub but not garden rituals, computeXp counted garden but not GitHub.
// Both surfaces now use computeXp() + getGithubStats(). The GitHub events API
// is external and rate-limited, so results are cached for 6 hours; on fetch
// failure the stale cache is served rather than dropping the level.

export interface GithubStats {
  commitDays: number
  streak: number
  xp: number
}

// Consecutive-day streak ending today or yesterday, over YYYY-MM-DD strings.
//
// `today` is passed in rather than read from the clock: the server's UTC day
// is not the user's, and a streak that silently resets at midnight-plus-two
// is the most visible way that difference shows up.
export function currentDayStreak(sortedDates: string[], today: string): number {
  if (!sortedDates.length) return 0
  const yesterday = new Date(Date.parse(today + "T12:00:00Z") - 86400000).toISOString().slice(0, 10)
  const set = new Set(sortedDates)
  const start = set.has(today) ? today : set.has(yesterday) ? yesterday : null
  if (!start) return 0
  let streak = 0
  let cur = new Date(start)
  while (set.has(cur.toISOString().slice(0, 10))) {
    streak++
    cur = new Date(cur.getTime() - 86400000)
  }
  return streak
}

const GITHUB_STATS_KEY = "github:stats"
const GITHUB_STATS_TTL_MS = 6 * 60 * 60 * 1000

export async function getGithubStats(userId: string): Promise<GithubStats> {
  let stale: GithubStats | null = null

  const cached = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: GITHUB_STATS_KEY } },
  }).catch(() => null)
  if (cached) {
    try {
      const parsed = JSON.parse(cached.value) as GithubStats & { at: number }
      stale = { commitDays: parsed.commitDays ?? 0, streak: parsed.streak ?? 0, xp: parsed.xp ?? 0 }
      if (Date.now() - (parsed.at ?? 0) < GITHUB_STATS_TTL_MS) return stale
    } catch { /* refetch */ }
  }

  const profileRows = await prisma.$queryRaw<{ username: string; accessToken: string | null }[]>`
    SELECT "username", "accessToken" FROM "GitHubProfile" WHERE "userId" = ${userId} LIMIT 1
  `.catch(() => [] as { username: string; accessToken: string | null }[])
  const profile = profileRows[0]
  if (!profile) return { commitDays: 0, streak: 0, xp: 0 }

  const headers: Record<string, string> = {
    "User-Agent": "emergenthealth/1.0",
    Accept: "application/vnd.github+json",
  }
  if (profile.accessToken) headers["Authorization"] = `Bearer ${profile.accessToken}`
  const res = await fetch(
    `https://api.github.com/users/${profile.username}/events?per_page=100`,
    { headers },
  ).catch(() => null)
  if (!res?.ok) return stale ?? { commitDays: 0, streak: 0, xp: 0 }

  interface PushEvent {
    type: string
    created_at: string
    payload: { commits?: { sha: string }[]; size?: number }
  }
  const events: PushEvent[] = await res.json().catch(() => [])
  const commitsByDay: Record<string, number> = {}
  for (const event of events) {
    if (event.type !== "PushEvent") continue
    const day = event.created_at.slice(0, 10)
    const count = event.payload.commits?.length ?? event.payload.size ?? 0
    commitsByDay[day] = (commitsByDay[day] ?? 0) + count
  }
  const commitDays = Object.keys(commitsByDay).filter(d => (commitsByDay[d] ?? 0) > 0)
  const statsValue: GithubStats = {
    commitDays: commitDays.length,
    streak: currentDayStreak(commitDays.sort(), await userToday(userId)),
    xp: commitDays.length * 8,
  }

  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: GITHUB_STATS_KEY } },
    create: { userId, key: GITHUB_STATS_KEY, value: JSON.stringify({ ...statsValue, at: Date.now() }) },
    update: { value: JSON.stringify({ ...statsValue, at: Date.now() }) },
  }).catch(() => null)

  return statsValue
}

export interface XpBreakdown {
  habits: number
  checkins: number
  sleep: number
  weight: number
  mood: number
  journal: number
  intake: number
  focus: number
  reading: number
  supplements: number
  garden: number
  workouts: number
  total: number
}

// Computes canonical XP for a user (excludes github — callers may add it separately)
export async function computeXp(userId: string): Promise<XpBreakdown> {
  const since = new Date(Date.now() - 365 * 86400000)

  const [
    habitCount,
    healthCount,
    weightCount,
    moodCount,
    journalCount,
    intakeLogs,
    focusCount,
    bookCount,
    workoutCount,
    ouraTagDays,
    timezone,
  ] = await Promise.all([
    prisma.habitCompletion.count({ where: { userId, date: { gte: since } } }).catch(() => 0),
    prisma.healthLog.count({ where: { userId } }).catch(() => 0),
    prisma.healthLog.count({ where: { userId, weight: { not: null } } }).catch(() => 0),
    prisma.moodLog.count({ where: { userId } }).catch(() => 0),
    prisma.dailyNote.count({ where: { userId } }).catch(() => 0),
    prisma.intakeLog.findMany({ where: { userId, loggedAt: { gte: since } }, select: { loggedAt: true } }).catch(() => [] as { loggedAt: Date }[]),
    prisma.focusSession.count({ where: { userId, type: "focus" } }).catch(() => 0),
    prisma.book.count({ where: { userId, status: "done" } }).catch(() => 0),
    prisma.stravaActivity.count({ where: { userId, startDate: { gte: since } } }).catch(() => 0),
    prisma.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT "day" FROM "OuraTag"
      WHERE "userId" = ${userId}
        AND "tagName" IS NOT NULL AND "tagName" != ''
        AND "tagName" NOT ILIKE '%coffee%' AND "tagName" NOT ILIKE '%water%'
        AND "tagName" NOT ILIKE '%tea%'    AND "tagName" NOT ILIKE '%beer%'
        AND "tagName" NOT ILIKE '%wine%'   AND "tagName" NOT ILIKE '%ml%'
        AND "tagName" NOT ILIKE '%matcha%' AND "tagName" NOT ILIKE '%sparkling%'
        AND "tagName" NOT ILIKE '%kava%'   AND "tagName" NOT ILIKE '%káva%'
        AND "tagName" NOT ILIKE '%pivo%'   AND "tagName" NOT ILIKE '%víno%'
    `.catch(() => [] as { day: string }[]),
    getUserTimezone(userId),
  ])

  // Morning check-ins: the completion screen has always promised +10 XP, but
  // check-ins were never part of the total (they only live in MorningCheckIn,
  // not MoodLog), so the most consistent daily ritual scored nothing.
  const checkinRows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "MorningCheckIn" WHERE "userId" = ${userId}
  `.catch(() => [{ n: BigInt(0) }])
  const checkinCount = Number(checkinRows[0]?.n ?? 0)

  // Daily garden rituals (once-a-day watering and animal feeding)
  const [wateredRow, fedRow] = await Promise.all([
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "garden:watered" } },
    }).catch(() => null),
    prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "garden:fed" } },
    }).catch(() => null),
  ])
  let wateredCount = 0
  try { wateredCount = wateredRow ? (JSON.parse(wateredRow.value).count ?? 0) : 0 } catch { /* */ }
  let fedCount = 0
  try { fedCount = fedRow ? (JSON.parse(fedRow.value).count ?? 0) : 0 } catch { /* */ }

  const intakeDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone })
  const intakeDays   = new Set(intakeLogs.map(l => intakeDayFmt.format(l.loggedAt as Date))).size
  const suppDays     = (ouraTagDays as { day: string }[]).length

  const habits     = habitCount  * 10
  const checkins   = checkinCount * 10
  const sleep      = healthCount * 5
  const weight     = weightCount * 3
  const mood       = moodCount   * 5
  const journal    = journalCount * 10
  const intake     = intakeDays  * 5
  const focus      = focusCount  * 10
  const reading    = bookCount   * 20
  const supplements = suppDays   * 5
  const garden     = (wateredCount + fedCount) * 5
  const workouts   = workoutCount * 10

  return {
    habits, checkins, sleep, weight, mood, journal, intake, focus, reading, supplements, garden, workouts,
    total: habits + checkins + sleep + weight + mood + journal + intake + focus + reading + supplements + garden + workouts,
  }
}
