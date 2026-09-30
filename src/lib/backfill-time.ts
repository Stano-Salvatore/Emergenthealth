import { addDaysISO, zonedClock } from "@/lib/local-date"

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
 * When something happened, as picked on screen: null = now, `ago` = minutes
 * before the moment of saving, `at` = "HH:MM" on the viewed day.
 *
 * "1h ago" is kept as an offset, not turned into a clock time when tapped: at
 * 00:30 an hour ago is 23:30 YESTERDAY, which a time on today's date cannot
 * say, and a page left open all afternoon must still mean an hour before the
 * tap.
 */
export type WhenChoice = null | { ago: number } | { at: string }

export function atFromChoice(
  date: string,
  when: WhenChoice,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  now = new Date(),
): string | undefined {
  if (!when) return undefined
  if ("ago" in when) return new Date(now.getTime() - when.ago * 60_000).toISOString()
  return zonedClock(timezone, date, when.at)?.toISOString()
}

/**
 * Whether a day on screen can still take a back-filled entry. One day inside
 * the server's window, so an evening default on the oldest day offered never
 * lands just past it.
 */
export function canBackfillDay(date: string, today: string): boolean {
  return date >= addDaysISO(today, -(BACKFILL_MAX_DAYS - 1)) && date <= today
}
