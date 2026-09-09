// Training sessions logged by hand.
//
// They live in the StravaActivity table rather than a table of their own,
// with `source = "manual"` and a synthetic stravaId. That is deliberate: the
// correlation engine, the brief, the chat context and the Training page all
// already read that table, so a session typed into the app joins every one
// of those the moment it's saved, and the day someone connects Strava their
// history doesn't fork into two lists. The type names are Strava's so the
// emoji map and the breakdown keep working.

import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr, zonedDateTime } from "@/lib/local-date"

/** The kinds of session the app offers by name. Values are Strava's type strings. */
export const WORKOUT_TYPES = [
  { value: "WeightTraining", label: "Strength" },
  { value: "Run",            label: "Run" },
  { value: "Ride",           label: "Cycling" },
  { value: "Walk",           label: "Walk" },
  { value: "Swim",           label: "Swim" },
  { value: "Yoga",           label: "Yoga / mobility" },
  { value: "Hike",           label: "Hike" },
  { value: "Workout",        label: "Other" },
] as const

export type WorkoutType = (typeof WORKOUT_TYPES)[number]["value"]
const TYPE_VALUES = new Set<string>(WORKOUT_TYPES.map(t => t.value))

/** Loose words people (and Emergy) use, folded onto the Strava names. */
const ALIASES: Record<string, WorkoutType> = {
  gym: "WeightTraining", weights: "WeightTraining", strength: "WeightTraining", lifting: "WeightTraining",
  weighttraining: "WeightTraining", "weight training": "WeightTraining", resistance: "WeightTraining",
  run: "Run", running: "Run", jog: "Run", jogging: "Run", treadmill: "Run",
  ride: "Ride", cycling: "Ride", bike: "Ride", biking: "Ride", spin: "Ride", spinning: "Ride",
  walk: "Walk", walking: "Walk",
  swim: "Swim", swimming: "Swim",
  yoga: "Yoga", mobility: "Yoga", stretching: "Yoga", pilates: "Yoga",
  hike: "Hike", hiking: "Hike",
  workout: "Workout", hiit: "Workout", crossfit: "Workout", climbing: "Workout", football: "Workout",
  soccer: "Workout", tennis: "Workout", boxing: "Workout", rowing: "Workout", other: "Workout",
}

export function normalizeWorkoutType(raw: unknown): WorkoutType | null {
  if (typeof raw !== "string") return null
  const s = raw.trim()
  if (TYPE_VALUES.has(s)) return s as WorkoutType
  return ALIASES[s.toLowerCase()] ?? null
}

export interface LogWorkoutInput {
  type: unknown
  minutes: unknown
  /** 1–10 */
  rpe?: unknown
  note?: unknown
  /** ISO datetime, "YYYY-MM-DDTHH:MM" in the user's zone, or omitted for now. */
  startedAt?: unknown
  distanceKm?: unknown
}

export type LogWorkoutResult =
  | { ok: true; id: string; day: string; type: WorkoutType; minutes: number; rpe: number | null }
  | { ok: false; error: string }

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)))

/** Validate and store one session. Shared by the API and Emergy's log_workout. */
export async function logWorkout(userId: string, input: LogWorkoutInput): Promise<LogWorkoutResult> {
  const type = normalizeWorkoutType(input.type)
  if (!type) return { ok: false, error: `Unknown session type. Use one of: ${WORKOUT_TYPES.map(t => t.label).join(", ")}.` }

  const minutesN = Number(input.minutes)
  if (!Number.isFinite(minutesN) || minutesN < 1 || minutesN > 24 * 60) {
    return { ok: false, error: "minutes must be between 1 and 1440" }
  }
  const minutes = clampInt(minutesN, 1, 24 * 60)

  let rpe: number | null = null
  if (input.rpe != null && input.rpe !== "") {
    const r = Number(input.rpe)
    if (!Number.isFinite(r) || r < 1 || r > 10) return { ok: false, error: "effort must be 1–10" }
    rpe = clampInt(r, 1, 10)
  }

  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null

  let distanceM: number | null = null
  if (input.distanceKm != null && input.distanceKm !== "") {
    const d = Number(input.distanceKm)
    if (Number.isFinite(d) && d > 0 && d < 1000) distanceM = Math.round(d * 1000)
  }

  const timezone = await getUserTimezone(userId)
  let startDate: Date
  if (typeof input.startedAt === "string" && input.startedAt.trim()) {
    const s = input.startedAt.trim()
    // A bare local datetime is read in the user's zone; anything with an
    // offset or Z is taken as-is.
    const parsed = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? new Date(s) : zonedDateTime(timezone, s)
    if (!parsed || Number.isNaN(parsed.getTime())) return { ok: false, error: "startedAt is not a valid date" }
    startDate = parsed
  } else {
    // "Now" means the session just ended, so it started `minutes` ago.
    startDate = new Date(Date.now() - minutes * 60_000)
  }
  if (startDate.getTime() > Date.now() + 5 * 60_000) return { ok: false, error: "sessions can't start in the future" }

  const day = localDateStr(timezone, startDate)
  const stravaId = `manual_${randomUUID()}`
  const label = WORKOUT_TYPES.find(t => t.value === type)?.label ?? type
  const row = await prisma.stravaActivity.create({
    data: {
      userId, stravaId, type, name: label, source: "manual",
      distanceM, movingTimeSec: minutes * 60, elapsedTimeSec: minutes * 60,
      elevationM: null, avgHR: null, maxHR: null,
      startDate, day, rpe, note,
    },
    select: { id: true },
  })
  return { ok: true, id: row.id, day, type, minutes, rpe }
}

/** Remove a manual session. Synced rows are Strava's to delete. */
export async function deleteWorkout(userId: string, id: string): Promise<boolean> {
  const res = await prisma.stravaActivity.deleteMany({ where: { id, userId, source: "manual" } })
  return res.count > 0
}

/** Sessions in load form for the last 28 days plus a little slack. */
export async function loadSessionsForUser(userId: string, today: string) {
  const since = new Date(Date.parse(today + "T00:00:00Z") - 35 * 86_400_000).toISOString().slice(0, 10)
  const rows = await prisma.stravaActivity.findMany({
    where: { userId, day: { gte: since, lte: today } },
    select: { day: true, movingTimeSec: true, rpe: true },
  }).catch(() => [] as { day: string; movingTimeSec: number; rpe: number | null }[])
  return rows.map(r => ({ day: r.day, minutes: Math.round(r.movingTimeSec / 60), rpe: r.rpe }))
}
