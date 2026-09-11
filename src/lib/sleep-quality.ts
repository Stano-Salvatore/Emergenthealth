// Was this actually a measured night, or was the ring simply not on?
//
// Oura publishes a session for whatever it captured. When the ring dies mid-
// night, is taken off, or never seats properly, that can be a few minutes of
// "sleep" — and the sync, which picks the longest session for each day,
// promotes that fragment to being the night.
//
// The damage is not the small number itself, it is that the number looks real.
// A 9-minute night enters the averages, the daily score, and the correlation
// engine as a genuine short night. Land one on an evening with a drink and the
// engine has false evidence for a pattern that never happened — which is the
// one thing this app is not allowed to do.
//
// The rest of the record already gets this right: on those nights HRV,
// readiness, SpO2 and breathing rate all come back null, because there was
// nothing to measure. Only the sleep fields pretend.
//
// So the test is not "was this a short night" — people do have real short
// nights, and throwing those away would be its own dishonesty. The test is
// whether the ring was gathering physiology at all. A session with no HRV and
// no breathing rate is not a night that went badly; it is a night that was
// never recorded.

/** Under this, a session is short enough that it needs corroborating. */
export const SHORT_NIGHT_SECONDS = 2 * 3600

export interface NightCandidate {
  totalSleepSeconds: number | null
  hrv: number | null
  breathRate: number | null
}

/**
 * True when the session can be trusted as a night's measurement.
 *
 * Deliberately conservative: it only ever rejects very short sessions, and
 * only when the physiological channels are missing too. A genuine two-hour
 * night with HRV and a breathing rate stays, because that is data.
 */
export function isMeasuredNight(n: NightCandidate): boolean {
  if (n.totalSleepSeconds == null) return false
  if (n.totalSleepSeconds >= SHORT_NIGHT_SECONDS) return true
  // Short. Trust it only if the ring was actually gathering physiology.
  return n.hrv != null || n.breathRate != null
}

// ─── A night with no row at all ───────────────────────────────────────────────
//
// The test above answers "is this session real". This one answers the question
// that comes after it: the row exists, the sleep fields are empty, and the
// weekly answer has to say something about the hole.
//
// "No data" covers two situations that are nothing alike. One is a ring in a
// drawer, where the whole day is missing and there is simply nothing to say.
// The other is a ring that was worn all day and still filed no night — which
// is a fact about the night, not about the data, and is usually the answer to
// "why does this week look short".
//
// The day's step count separates them, and separates them cleanly: on this
// account the nine nights without a row split 13759 / 12742 / 10166 / 7506 /
// 7330 steps against 487 / 421 / 148 / 55, with nothing in between. A day that
// never broke a thousand steps is a device that was not being carried.
//
// It is still an inference, so the wording it feeds stays hedged, and a day
// with no step count at all gets no verdict rather than a guessed one.

/** Under this, a whole day of steps is a device in a drawer rather than a person. */
export const RING_OFF_MAX_STEPS = 1000

export type MissingNightReason = "ring-off" | "awake" | "unknown"

/**
 * Why a day has no night on it, as far as the step count can tell.
 *
 * - `ring-off`  — the day barely moved, so nothing was measured either.
 * - `awake`     — a normal day of movement, so the ring was on and the night
 *                 still did not register.
 * - `unknown`   — no step count, so no claim.
 */
export function whyNightMissing(steps: number | null | undefined): MissingNightReason {
  if (steps == null) return "unknown"
  return steps < RING_OFF_MAX_STEPS ? "ring-off" : "awake"
}
