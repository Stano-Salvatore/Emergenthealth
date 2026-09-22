// Two instruments write the same HealthLog row, and until now the last one
// to sync won the day.
//
// oura-sync writes a night and a day from the ring; /api/sync/health writes
// the same columns from Health Connect — hourly while the app is open, which
// made it the effective winner: a day's steps could be the ring's at 10:00
// UTC and the phone pedometer's an hour later, and a ring night's duration
// could be replaced by whatever Health Connect held for that night (Oura's
// own export via Health Connect, or a watch). Invisible on a phone where
// Health Connect's sleep IS Oura's; wrong the day a second wearable appears.
//
// One rule now: THE RING WINS WHERE IT SPEAKS, and the phone fills what the
// ring left blank. `ringAt` on the row marks that the ring has written it;
// while it is set, Health Connect may only fill columns that are still null.
// The ring's own sync overwrites freely, as it always did — a corrected
// night from Oura is the better night.
//
// Pure, so the rule can be tested without a database. The route reads the
// row and hands it here; whatever comes back is what gets written.

/** The columns both writers can produce. */
export const SHARED_COLUMNS = [
  "sleepDuration", "deepSleep", "remSleep", "lightSleep",
  "steps", "caloriesBurned", "activeMinutes", "restingHR",
] as const
export type SharedColumn = (typeof SHARED_COLUMNS)[number]

export type SharedValues = Partial<Record<SharedColumn, number | null | undefined>>

/**
 * The subset of `incoming` that Health Connect may write over `existing`.
 *
 * No existing row, or a row the ring has never written: everything. A ring
 * row: only the columns the ring left null. A key whose incoming value is
 * undefined is never included — "not sent" must not become "set to null".
 */
export function phoneFieldsRespectingRing<T extends SharedValues>(
  existing: (SharedValues & { ringAt?: Date | null }) | null,
  incoming: T,
): Partial<T> {
  const out: Partial<T> = {}
  const ringSpoke = existing?.ringAt != null
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    const value = incoming[key]
    if (value === undefined) continue
    const col = key as unknown as SharedColumn
    if (ringSpoke && SHARED_COLUMNS.includes(col) && existing![col] != null) continue
    out[key] = value
  }
  return out
}
