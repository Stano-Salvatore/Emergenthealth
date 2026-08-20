import { prisma } from "@/lib/prisma"

// When the weekly review lands, in the user's own timezone.
//
// Settings has had a day-and-hour picker since long before the review existed.
// It wrote User.digestDay / digestHour, which only the /api/cron/digest
// endpoint read — and that endpoint was never added to the cron loop, so
// nothing it scheduled ever sent. The control said "Digest emails will be sent
// automatically on your chosen schedule" and did nothing at all.
//
// The email that does arrive every week is Emergy's review, so that is what the
// picker governs now. Stored as a preference rather than in the old columns so
// "never chosen" stays distinguishable from "chose Monday 08:00" — otherwise
// every existing account would silently move off the Sunday evening it has now.

const KEY = "weekly_review_time"

export type ReviewSchedule = { day: number; hour: number }

// Sunday evening: late enough that the week is over, early enough to still do
// something about next week.
export const DEFAULT_SCHEDULE: ReviewSchedule = { day: 0, hour: 18 }

export function parseSchedule(value: string | null | undefined): ReviewSchedule {
  // Matched whole, not parseInt'd: parseInt("1.5") is 1 and parseInt("2abc")
  // is 2, so a malformed value would quietly become a plausible-looking time
  // rather than falling back to the default.
  const m = /^(\d):(\d{1,2})$/.exec(value ?? "")
  if (!m) return DEFAULT_SCHEDULE
  const day = Number(m[1])
  const hour = Number(m[2])
  if (day > 6 || hour > 23) return DEFAULT_SCHEDULE
  return { day, hour }
}

export function formatSchedule(s: ReviewSchedule): string {
  return `${s.day}:${s.hour}`
}

/**
 * Does this local day-and-hour fall in the user's review window?
 *
 * The window is two hours wide because the cron ticks every ten minutes and a
 * generation can outlive a single tick; the per-day sent log stops the second
 * hour from sending a duplicate.
 */
export function isReviewWindow(s: ReviewSchedule, localDow: number, localHour: number): boolean {
  if (localDow !== s.day) return false
  return localHour === s.hour || localHour === s.hour + 1
}

export async function readSchedule(userId: string): Promise<ReviewSchedule> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT "value" FROM "UserPreference"
    WHERE "userId" = ${userId} AND "key" = ${KEY}
    LIMIT 1
  `.catch(() => [] as { value: string }[])
  return parseSchedule(rows[0]?.value)
}

export async function writeSchedule(userId: string, s: ReviewSchedule): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "UserPreference" ("userId", "key", "value")
    VALUES (${userId}, ${KEY}, ${formatSchedule(s)})
    ON CONFLICT ("userId", "key") DO UPDATE SET "value" = ${formatSchedule(s)}
  `
}

export const SCHEDULE_PREF_KEY = KEY
