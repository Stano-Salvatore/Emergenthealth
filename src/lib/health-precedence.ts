// Two instruments write the same HealthLog row, and until now the last one
// to sync won the day.
//
// oura-sync writes a night and a day from the ring; /api/sync/health-connect
// writes the same columns from Health Connect — 30 days at a time, hourly
// while the app is open, which made it the effective winner: a day's steps
// could be the ring's at 10:00 UTC and the phone pedometer's an hour later,
// a ring night's total sleep could become Health Connect's time in bed, and
// the ring's night HRV a day average of phone samples. /api/sync/health (the
// manual Log Day form) writes a subset of the same columns.
//
// One rule now: THE RING WINS WHERE IT SPEAKS, and the phone fills what the
// ring left blank. `ringAt` on the row marks that the ring has written it;
// while it is set, a phone writer may only fill columns that are still null.
// The ring's own sync overwrites freely, as it always did — a corrected
// night from Oura is the better night.
//
// A night is one measurement, not six columns: once the ring holds any of
// it, the phone's stages or bed times come from a different session and
// would not add up to the ring's total, so none of them are taken.
//
// The day's activity is the ring's only when the ring's activity document was
// stored: activityScore and sedentaryTime come from nowhere else. A day the
// ring sat on its charger stores none of it (oura-sync), and the steps on
// that row are the phone's own — the phone must be able to raise them hour
// by hour, or the first sync's morning count stands for the whole day.
//
// Pure, so the rule can be tested without a database. The route reads the
// row with PRECEDENCE_SELECT and hands it here; whatever comes back is what
// gets written.

/** The columns both writers can produce. */
export const SHARED_COLUMNS = [
  "sleepDuration", "deepSleep", "remSleep", "lightSleep", "sleepStart", "sleepEnd",
  "steps", "caloriesBurned", "totalCalories", "activeMinutes",
  "restingHR", "hrv", "spo2",
] as const
export type SharedColumn = (typeof SHARED_COLUMNS)[number]

const NIGHT_COLUMNS: readonly SharedColumn[] = [
  "sleepDuration", "deepSleep", "remSleep", "lightSleep", "sleepStart", "sleepEnd",
]

const ACTIVITY_COLUMNS: readonly SharedColumn[] = [
  "steps", "caloriesBurned", "totalCalories", "activeMinutes",
]

/** Written only by oura-sync, and only from a worn day's activity document. */
const RING_ACTIVITY_MARKERS = ["activityScore", "sedentaryTime"] as const
type RingActivityMarker = (typeof RING_ACTIVITY_MARKERS)[number]

export type SharedValues = Partial<Record<SharedColumn, number | Date | null | undefined>>

type ExistingRow = SharedValues & Partial<Record<RingActivityMarker, number | null>> & { ringAt?: Date | null }

/**
 * What a route must read before calling phoneFieldsRespectingRing. A column
 * left out of the read looks null to the helper, and null means "fill it".
 */
export const PRECEDENCE_SELECT = {
  ringAt: true,
  sleepDuration: true, deepSleep: true, remSleep: true, lightSleep: true, sleepStart: true, sleepEnd: true,
  steps: true, caloriesBurned: true, totalCalories: true, activeMinutes: true,
  restingHR: true, hrv: true, spo2: true,
  activityScore: true, sedentaryTime: true,
} as const satisfies Record<SharedColumn | RingActivityMarker | "ringAt", true>

/** The ring has written this row and holds at least part of its night. */
export function ringHoldsNight(existing: ExistingRow | null): boolean {
  return existing?.ringAt != null && NIGHT_COLUMNS.some(c => existing[c] != null)
}

/**
 * The subset of `incoming` that a phone writer may write over `existing`.
 *
 * No existing row, or a row the ring has never written: everything. A ring
 * row: only the columns the ring left null, and none of the night's columns
 * once the ring holds any of them; the activity columns only when the ring's
 * activity document is on the row. A key whose incoming value is undefined is
 * never included — "not sent" must not become "set to null".
 */
export function phoneFieldsRespectingRing<T extends SharedValues>(
  existing: ExistingRow | null,
  incoming: T,
): Partial<T> {
  const out: Partial<T> = {}
  const ringSpoke = existing?.ringAt != null
  const ringNight = ringHoldsNight(existing)
  const ringActivity = ringSpoke && RING_ACTIVITY_MARKERS.some(c => existing![c] != null)
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    const value = incoming[key]
    if (value === undefined) continue
    const col = key as unknown as SharedColumn
    if (ringSpoke && SHARED_COLUMNS.includes(col)) {
      if (existing![col] != null && (ringActivity || !ACTIVITY_COLUMNS.includes(col))) continue
      if (ringNight && NIGHT_COLUMNS.includes(col)) continue
    }
    out[key] = value
  }
  return out
}
