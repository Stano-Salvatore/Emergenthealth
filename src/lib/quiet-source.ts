// A ring that has gone quiet, said once.
//
// The brief now says "no sleep data" honestly, but nobody says *why*: a ring
// left on the charger, a dead battery, a revoked Oura token all look the same
// from the dashboard — a morning with nothing in it. This decides when that
// silence deserves one push, and only one: a nudge repeated every morning of
// the same quiet spell is nagging, and a nag gets muted along with everything
// else Emergy sends.
//
// Oura only. It is the one sleep source the server pulls on a schedule, so
// its silence is meaningful. Health Connect sleep arrives when the phone
// syncs it; a gap there means the app wasn't opened, and calling that a
// broken ring would be inventing a fault.

import type { SyncRun } from "@/lib/sync-status"
import { addDaysISO } from "@/lib/local-date"

/** Nights missing before the silence is worth a push. */
export const QUIET_AFTER_NIGHTS = 2
/** The same spell is not raised again within this many days. */
export const REPEAT_AFTER_DAYS = 7

/** UserPreference key remembering which spell was last raised. */
export const NOTIFIED_KEY = "quiet_source_notified"

export interface QuietNotified { key: string; at: string }

export function parseNotified(raw: string | null | undefined): QuietNotified | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return typeof v?.key === "string" && typeof v?.at === "string" ? v : null
  } catch {
    return null
  }
}

export interface QuietInput {
  /** The user's local day. */
  today: string
  localHour: number
  /** Day of the newest HealthLog row with a sleep duration, or null if none ever. */
  newestSleepDay: string | null
  /** The last recorded Oura sync run, or null if it has never run. */
  lastRun: SyncRun | null
  notified: QuietNotified | null
}

export interface QuietNudge {
  /** Identifies the spell, so the same one is never raised twice. */
  key: string
  body: string
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000)
}

function dayLabel(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
}

/**
 * What to push, if anything. Pure: the cron supplies the facts.
 *
 * A failing sync outranks a quiet ring — when the token has been revoked the
 * ring may well be on the finger, and "charge your ring" would send someone
 * to fix the wrong thing.
 */
export function judgeQuietSource(input: QuietInput): QuietNudge | null {
  const { today, localHour, newestSleepDay, lastRun, notified } = input
  // Daytime only: the sent memory has no hour in it, and a "your ring is
  // off" at 03:00 is exactly when the ring is meant to be on.
  if (localHour < 10 || localHour >= 20) return null

  let nudge: QuietNudge | null = null

  if (lastRun && !lastRun.ok) {
    nudge = {
      key: "sync-failing",
      body: `Oura sync has been failing${lastRun.error ? ` (${lastRun.error})` : ""} — no sleep can land until it's reconnected in Settings → Data connections.`,
    }
  } else if (newestSleepDay != null) {
    const missing = daysBetween(newestSleepDay, today)
    if (missing >= QUIET_AFTER_NIGHTS) {
      nudge = {
        key: `quiet:${newestSleepDay}`,
        body: `No sleep from the ring since ${dayLabel(newestSleepDay)} — ${missing} nights missing. Is it on the finger and charged?`,
      }
    }
  }
  // Never had a night at all: that is onboarding's job, not a nudge's.
  if (!nudge) return null

  if (notified?.key === nudge.key) {
    const since = daysBetween(notified.at.slice(0, 10), today)
    if (since < REPEAT_AFTER_DAYS) return null
  }
  return nudge
}

/** The day this spell would be considered stale on, for tests and the log. */
export function repeatDay(fromDay: string): string {
  return addDaysISO(fromDay, REPEAT_AFTER_DAYS)
}
