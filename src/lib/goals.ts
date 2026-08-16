// The one place that knows what a user's goals are.
//
// Goals lived in a JSON blob inside a DailyNote row dated 0001-01-01, and five
// files read it: the goals API, the dashboard, the health page, the caffeine
// route and body-load — each parsing it themselves, each carrying its own copy
// of the defaults. Two of those copies had already drifted. There is a table
// now, and this is the only thing that reads it.

import { prisma } from "@/lib/prisma"

export interface Goals {
  sleepH: number
  steps: number
  waterMl: number
  focusMin: number
  habitsTarget: number
  readinessMin: number
  /** Caffeine, milligrams per day. */
  coffeeMax: number
  weightKg: number | null
  heightCm: number | null
  birthYear: number | null
  sex: "male" | "female" | null
}

export const DEFAULT_GOALS: Goals = {
  sleepH: 7.5,
  steps: 8000,
  waterMl: 2000,
  focusMin: 90,
  habitsTarget: 100,
  readinessMin: 70,
  coffeeMax: 400,
  weightKg: null,
  heightCm: null,
  birthYear: null,
  sex: null,
}

/** Bounds that keep a typo from turning a goal into a divide-by-zero. */
const NUMERIC_LIMITS: Record<string, { min: number; max: number }> = {
  sleepH:       { min: 1,    max: 24 },
  steps:        { min: 100,  max: 100_000 },
  waterMl:      { min: 100,  max: 20_000 },
  focusMin:     { min: 5,    max: 1_440 },
  habitsTarget: { min: 1,    max: 100 },
  readinessMin: { min: 1,    max: 100 },
  coffeeMax:    { min: 1,    max: 5_000 },
  weightKg:     { min: 20,   max: 400 },
  heightCm:     { min: 50,   max: 260 },
  birthYear:    { min: 1900, max: 2200 },
}

const INTEGER_KEYS = new Set(["steps", "waterMl", "focusMin", "habitsTarget", "readinessMin", "coffeeMax", "birthYear"])
const NULLABLE_KEYS = new Set(["weightKg", "heightCm", "birthYear", "sex"])

/**
 * Fold arbitrary input (an API body, or a legacy JSON blob) onto a base set of
 * goals. Unknown keys, out-of-range numbers and unparseable values are
 * ignored rather than stored — a goal nothing can satisfy is worse than the
 * default it replaced.
 */
export function mergeGoals(base: Goals, patch: unknown): Goals {
  if (!patch || typeof patch !== "object") return { ...base }
  const out: Goals = { ...base }

  for (const [key, raw] of Object.entries(patch as Record<string, unknown>)) {
    if (!(key in DEFAULT_GOALS)) continue

    if (key === "sex") {
      if (raw === "male" || raw === "female") out.sex = raw
      else if (raw === null || raw === "") out.sex = null
      continue
    }

    if (raw === null && NULLABLE_KEYS.has(key)) {
      ;(out as unknown as Record<string, unknown>)[key] = null
      continue
    }

    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    const limit = NUMERIC_LIMITS[key]
    if (limit && (n < limit.min || n > limit.max)) continue
    ;(out as unknown as Record<string, unknown>)[key] = INTEGER_KEYS.has(key) ? Math.round(n) : n
  }

  return out
}

/** The legacy sentinel row: a DailyNote whose "date" is the year 1. */
const LEGACY_DATE = new Date("0001-01-01")

/**
 * A user's goals, defaults filled in. Reads the legacy blob once if the table
 * has no row yet, so nobody's settings vanish on deploy; the blob is removed
 * after it's been carried over, which also stops it surfacing as a journal
 * entry dated the year 1.
 */
export async function getGoals(userId: string): Promise<Goals> {
  const row = await prisma.userGoals.findUnique({ where: { userId } }).catch(() => null)
  if (row) {
    return mergeGoals(DEFAULT_GOALS, {
      sleepH: row.sleepH, steps: row.steps, waterMl: row.waterMl, focusMin: row.focusMin,
      habitsTarget: row.habitsTarget, readinessMin: row.readinessMin, coffeeMax: row.coffeeMax,
      weightKg: row.weightKg, heightCm: row.heightCm, birthYear: row.birthYear, sex: row.sex,
    })
  }

  const legacy = await prisma.dailyNote.findUnique({
    where: { userId_date: { userId, date: LEGACY_DATE } },
    select: { content: true },
  }).catch(() => null)
  if (!legacy) return { ...DEFAULT_GOALS }

  let parsed: unknown = null
  try { parsed = JSON.parse(legacy.content) } catch { /* unreadable — defaults it is */ }
  const goals = mergeGoals(DEFAULT_GOALS, parsed)

  const migrated = await prisma.userGoals.create({ data: { userId, ...goals } }).catch(() => null)
  if (migrated) {
    await prisma.dailyNote.delete({
      where: { userId_date: { userId, date: LEGACY_DATE } },
    }).catch(() => {})
  }
  return goals
}

/** Apply a partial update on top of whatever the user has now. */
export async function saveGoals(userId: string, patch: unknown): Promise<Goals> {
  const current = await getGoals(userId)
  const next = mergeGoals(current, patch)
  await prisma.userGoals.upsert({
    where: { userId },
    create: { userId, ...next },
    update: next,
  })
  return next
}
