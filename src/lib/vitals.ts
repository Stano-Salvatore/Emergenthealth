// A reading the body could actually have produced, or nothing.
//
// Two days in one week were stored with an SpO₂ of 0%. Nobody has ever had an
// SpO₂ of 0% and gone on to sync it. Somewhere upstream an absent value became
// a number, and every guard between there and the database was a `!= null`
// check — which 0 passes.
//
// This is the same mistake this codebase names everywhere else: absent is not
// zero. The difference is that `!= null` only catches it when the upstream is
// honest enough to say null. A zero that has already been invented reads as a
// measurement, and downstream nothing can tell: it drags averages, flattens
// charts, and is exactly the shape of reading the anomaly watch exists to
// shout about.
//
// So the last gate before storage asks a different question — not "is there a
// value" but "could a body have produced this one". The bounds are deliberately
// generous. The job is to reject 0 and the plainly impossible, not to second-
// guess an unusual but real reading.

/** The value if it falls inside the range, otherwise null. */
function within(value: number | null | undefined, min: number, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return value >= min && value <= max ? value : null
}

/**
 * Blood oxygen, as a percentage.
 *
 * The floor is 50: survivable readings go lower in a hospital, but not on a
 * wrist or a finger ring that then uploads them, and 0 is the value actually
 * seen in this database.
 */
export function plausibleSpo2(value: number | null | undefined): number | null {
  return within(value, 50, 100)
}

/**
 * Resting heart rate, bpm.
 *
 * The floor is 25 rather than something safer-sounding: trained endurance
 * athletes genuinely sleep in the high twenties, and throwing away a real
 * reading is its own kind of wrong.
 */
export function plausibleHeartRate(value: number | null | undefined): number | null {
  return within(value, 25, 220)
}

/** HRV as RMSSD in milliseconds. Zero means the sensor had nothing. */
export function plausibleHrv(value: number | null | undefined): number | null {
  return within(value, 1, 500)
}

/** Breathing rate, breaths per minute. */
export function plausibleBreathRate(value: number | null | undefined): number | null {
  return within(value, 4, 40)
}
