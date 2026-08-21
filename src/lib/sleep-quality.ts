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
