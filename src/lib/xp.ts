import { prisma } from "@/lib/prisma"

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

export interface XpBreakdown {
  habits: number
  sleep: number
  weight: number
  mood: number
  journal: number
  intake: number
  focus: number
  reading: number
  supplements: number
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
    ouraTagDays,
  ] = await Promise.all([
    prisma.habitCompletion.count({ where: { userId, date: { gte: since } } }).catch(() => 0),
    prisma.healthLog.count({ where: { userId } }).catch(() => 0),
    prisma.healthLog.count({ where: { userId, weight: { not: null } } }).catch(() => 0),
    prisma.moodLog.count({ where: { userId } }).catch(() => 0),
    prisma.dailyNote.count({ where: { userId } }).catch(() => 0),
    prisma.intakeLog.findMany({ where: { userId, loggedAt: { gte: since } }, select: { loggedAt: true } }).catch(() => [] as { loggedAt: Date }[]),
    prisma.focusSession.count({ where: { userId, type: "focus" } }).catch(() => 0),
    prisma.book.count({ where: { userId, status: "done" } }).catch(() => 0),
    prisma.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT "day" FROM "OuraTag"
      WHERE "userId" = ${userId}
        AND "tagName" IS NOT NULL AND "tagName" != ''
        AND "tagName" NOT ILIKE '%coffee%' AND "tagName" NOT ILIKE '%water%'
        AND "tagName" NOT ILIKE '%tea%'    AND "tagName" NOT ILIKE '%beer%'
        AND "tagName" NOT ILIKE '%wine%'   AND "tagName" NOT ILIKE '%ml%'
    `.catch(() => [] as { day: string }[]),
  ])

  const intakeDays   = new Set(intakeLogs.map(l => (l.loggedAt as Date).toISOString().slice(0, 10))).size
  const suppDays     = (ouraTagDays as { day: string }[]).length

  const habits     = habitCount  * 10
  const sleep      = healthCount * 5
  const weight     = weightCount * 3
  const mood       = moodCount   * 5
  const journal    = journalCount * 10
  const intake     = intakeDays  * 5
  const focus      = focusCount  * 10
  const reading    = bookCount   * 20
  const supplements = suppDays   * 5

  return {
    habits, sleep, weight, mood, journal, intake, focus, reading, supplements,
    total: habits + sleep + weight + mood + journal + intake + focus + reading + supplements,
  }
}
