// Logging something at the time it happened, not the time it was remembered.
//
// loggedAt drives caffeine decay, the bedtime cutoff, body load, meal timing
// and the correlation engine's evening groups, so a lunch remembered at 22:00
// or a coffee logged six hours late moved all of them. The window is a week:
// long enough for "I forgot yesterday's dinner", short enough that a typo'd
// year can't file something into a season the insights have already read.

export const BACKFILL_MAX_DAYS = 7
/** A phone clock a little ahead of the server's is not "the future". */
const CLOCK_SLACK_MS = 2 * 60_000

/** null = now; otherwise the validated instant, or why it was refused. */
export function backfillAt(raw: unknown, now = new Date()): { at: Date } | { error: string } | null {
  if (raw == null || raw === "") return null
  if (typeof raw !== "string") return { error: "time must be an ISO timestamp" }
  const at = new Date(raw)
  if (Number.isNaN(at.getTime())) return { error: "time must be an ISO timestamp" }
  if (at.getTime() > now.getTime() + CLOCK_SLACK_MS) return { error: "That time is in the future." }
  if (at.getTime() < now.getTime() - BACKFILL_MAX_DAYS * 86_400_000) {
    return { error: `Only the last ${BACKFILL_MAX_DAYS} days can be filled in.` }
  }
  return { at }
}

/**
 * The instant a picked "HH:MM" on the viewed day means, in the device's own
 * clock — the clock the person read the time off. undefined = now.
 */
export function atFromChoice(date: string, hhmm: string | null): string | undefined {
  if (!hhmm) return undefined
  const [y, m, d] = date.split("-").map(Number)
  const [h, min] = hhmm.split(":").map(Number)
  return new Date(y, m - 1, d, h, min).toISOString()
}
