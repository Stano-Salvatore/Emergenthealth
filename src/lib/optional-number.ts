/**
 * A missing reading stays missing.
 *
 * `Number(null)` is `0` and `Number.isFinite(0)` is `true`, so the obvious
 * coercion silently turns "this phone reported no altitude" into "this phone
 * was at sea level", and "no accuracy reported" into "accuracy 0 m" — a
 * perfect fix, which is the most confident thing a GPS point can claim. Both
 * location ingest paths take nullable readings and both are fed sources that
 * really do send nulls, so this lives in one place rather than being got right
 * in one route and wrong in the other, which is what happened.
 */
export function optionalNumber(value: unknown, round?: (n: number) => number): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return round ? round(n) : n
}
