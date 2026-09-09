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
  /**
   * Weight goal. `mode` is the direction; `weightTargetKg` the finish line;
   * `weightPaceKgWk` how fast (always positive — the mode carries the sign).
   * The start fields are captured when the goal is set, so progress is
   * measured from a fixed line rather than from whatever last week was.
   */
  weightGoalMode: WeightGoalMode | null
  weightTargetKg: number | null
  weightPaceKgWk: number | null
  weightGoalStartKg: number | null
  /** ISO timestamp. */
  weightGoalStartedAt: string | null
}

export type WeightGoalMode = "lose" | "gain" | "maintain"
export const WEIGHT_GOAL_MODES: readonly WeightGoalMode[] = ["lose", "gain", "maintain"]

/** The pace band people can actually hold. Faster than this is a crash diet. */
export const WEIGHT_PACE_LIMITS = { min: 0.1, max: 1.0, recommendedMin: 0.25, recommendedMax: 0.75 } as const

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
  weightGoalMode: null,
  weightTargetKg: null,
  weightPaceKgWk: null,
  weightGoalStartKg: null,
  weightGoalStartedAt: null,
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
  weightTargetKg:    { min: 20,  max: 400 },
  weightPaceKgWk:    { min: WEIGHT_PACE_LIMITS.min, max: WEIGHT_PACE_LIMITS.max },
  weightGoalStartKg: { min: 20,  max: 400 },
}

const INTEGER_KEYS = new Set(["steps", "waterMl", "focusMin", "habitsTarget", "readinessMin", "coffeeMax", "birthYear"])
const NULLABLE_KEYS = new Set([
  "weightKg", "heightCm", "birthYear", "sex",
  "weightGoalMode", "weightTargetKg", "weightPaceKgWk", "weightGoalStartKg", "weightGoalStartedAt",
])

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

    if (key === "weightGoalMode") {
      if (raw === "lose" || raw === "gain" || raw === "maintain") out.weightGoalMode = raw
      else if (raw === null || raw === "" || raw === "none") out.weightGoalMode = null
      continue
    }

    if (key === "weightGoalStartedAt") {
      if (raw === null || raw === "") { out.weightGoalStartedAt = null; continue }
      const d = raw instanceof Date ? raw : new Date(String(raw))
      if (!Number.isNaN(d.getTime())) out.weightGoalStartedAt = d.toISOString()
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
      weightGoalMode: row.weightGoalMode, weightTargetKg: row.weightTargetKg,
      weightPaceKgWk: row.weightPaceKgWk, weightGoalStartKg: row.weightGoalStartKg,
      weightGoalStartedAt: row.weightGoalStartedAt,
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

  const migrated = await prisma.userGoals.create({ data: { userId, ...toRow(goals) } }).catch(() => null)
  if (migrated) {
    await prisma.dailyNote.delete({
      where: { userId_date: { userId, date: LEGACY_DATE } },
    }).catch(() => {})
  }
  return goals
}

/** The Goals shape with the one timestamp turned back into a Date for Prisma. */
function toRow(g: Goals) {
  return { ...g, weightGoalStartedAt: g.weightGoalStartedAt ? new Date(g.weightGoalStartedAt) : null }
}

/**
 * Pin the weight goal's starting line. Called on every save so the rules live
 * in one place: a goal that just appeared (or changed direction / target)
 * starts now, from the current weight; a goal that was cleared takes its
 * target, pace and start with it; an unchanged goal keeps its history.
 * `nowWeightKg` lets the caller pass a fresher weight than the goals row has.
 */
export function pinWeightGoalStart(
  current: Goals,
  next: Goals,
  nowWeightKg: number | null,
  now: Date = new Date(),
): Goals {
  const out = { ...next }
  if (!out.weightGoalMode) {
    out.weightTargetKg = null
    out.weightPaceKgWk = null
    out.weightGoalStartKg = null
    out.weightGoalStartedAt = null
    return out
  }
  const restarted =
    out.weightGoalMode !== current.weightGoalMode ||
    out.weightTargetKg !== current.weightTargetKg ||
    out.weightGoalStartKg == null ||
    out.weightGoalStartedAt == null
  if (restarted) {
    const startKg = nowWeightKg ?? out.weightKg ?? current.weightKg
    out.weightGoalStartKg = startKg != null && startKg >= 20 && startKg <= 400 ? startKg : null
    out.weightGoalStartedAt = now.toISOString()
  }
  if (out.weightGoalMode !== "maintain" && out.weightPaceKgWk == null) {
    out.weightPaceKgWk = 0.5
  }
  return out
}

/**
 * Apply a partial update on top of whatever the user has now. `nowWeightKg`
 * is the latest logged weight, if the caller has it — it becomes the goal's
 * starting line when a weight goal is (re)started.
 */
export async function saveGoals(userId: string, patch: unknown, nowWeightKg: number | null = null): Promise<Goals> {
  const current = await getGoals(userId)
  const next = pinWeightGoalStart(current, mergeGoals(current, patch), nowWeightKg)
  await prisma.userGoals.upsert({
    where: { userId },
    create: { userId, ...toRow(next) },
    update: toRow(next),
  })
  return next
}
