// A per-account daily count, kept in the database, for anything that spends
// the deployment's money on a model call.
//
// The in-memory limiter (lib/rate-limit) is a burst guard and nothing more: its
// counters live in one serverless instance, reset on every cold start, and
// multiply with every instance running at once. Sign-up is open to any Google
// account, so a cap meant to hold has to live in the database.
//
// One UserPreference row per account and cap, "day:n": a new day, or a value
// that can't be read, starts again at one. It resets on the user's own
// midnight and the table does not grow a row a day. The owner — who pays for
// every call — is never capped.

import { prisma } from "@/lib/prisma"
import { userToday } from "@/lib/user-timezone"

/** The owner — FEEDBACK_NOTIFY_EMAIL, or OWNER_EMAIL — is never capped. */
export function isOwnerEmail(email: string | null | undefined): boolean {
  const owner = (process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL)?.trim().toLowerCase()
  return !!owner && !!email && email.trim().toLowerCase() === owner
}

export async function isOwner(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  return isOwnerEmail(user?.email)
}

/** Uses left today, from the stored "day:n". Another day, or a value that can't be read, is the full cap. */
export function remainingFrom(stored: string | null, today: string, limit: number): number {
  const m = stored ? /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(stored) : null
  const used = m && m[1] === today ? Number(m[2]) : 0
  return Math.max(0, limit - used)
}

/** Today's remaining uses without spending one. null for the owner, who has no cap. */
export async function dailyRemaining(userId: string, key: string, limit: number): Promise<number | null> {
  if (await isOwner(userId)) return null
  const [today, row] = await Promise.all([
    userToday(userId),
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key } }, select: { value: true } }),
  ])
  return remainingFrom(row?.value ?? null, today, limit)
}

/**
 * Takes one use from today's cap, before the model is called.
 * `allowed: false` means the model must not be.
 *
 * Read-and-write in one statement, so two requests sent at once cannot both
 * see the last use. A database failure lets the request through — the burst
 * limiter still stands behind it, and locking someone out over a counter is
 * the worse failure.
 */
export async function claimDailyUse(
  userId: string,
  key: string,
  limit: number,
): Promise<{ allowed: boolean; used: number | null; remaining?: number }> {
  try {
    if (await isOwner(userId)) return { allowed: true, used: null }

    const today = await userToday(userId)
    const first = `${today}:1`
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, ${key}, ${first})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" =
        CASE WHEN split_part("UserPreference"."value", ':', 1) = ${today}
              AND split_part("UserPreference"."value", ':', 2) ~ '^[0-9]+$'
          THEN ${today} || ':' || (split_part("UserPreference"."value", ':', 2)::int + 1)::text
          ELSE ${first}
        END
      RETURNING "value"
    `
    const n = Number(/:(\d+)$/.exec(rows[0]?.value ?? "")?.[1] ?? 1)
    return { allowed: n <= limit, used: n, remaining: Math.max(0, limit - n) }
  } catch (error) {
    console.error(`[daily-cap] ${key} count failed, letting the request through`, error instanceof Error ? error.message : error)
    return { allowed: true, used: null }
  }
}

/**
 * Gives back a use the model failed to deliver — an outage is not something
 * the user got, and should not cost them. Only today's count, never below
 * zero; a failure here just leaves the use spent.
 */
export async function refundDailyUse(userId: string, key: string): Promise<void> {
  try {
    const today = await userToday(userId)
    await prisma.$executeRaw`
      UPDATE "UserPreference"
      SET "value" = ${today} || ':' || GREATEST(split_part("value", ':', 2)::int - 1, 0)::text
      WHERE "userId" = ${userId} AND "key" = ${key}
        AND split_part("value", ':', 1) = ${today}
        AND split_part("value", ':', 2) ~ '^[0-9]+$'
    `
  } catch { /* the use stays spent */ }
}

/**
 * The daily caps on paid model calls, per non-owner account. Each sits well
 * above what a person uses in a day — they exist to stop a script, not a user.
 */
export const DAILY_CAPS = {
  /** Opus reading a lab report, up to 4.2 MB. */
  labImport: { key: "cap_lab_import", limit: 20 },
  /** Opus writing the doctor's report. */
  healthReport: { key: "cap_health_report", limit: 10 },
  /** Sonnet reading a meal photo. */
  foodPhoto: { key: "cap_food_photo", limit: 60 },
  /** Sonnet rewriting the week's review. */
  weekReview: { key: "cap_week_review", limit: 5 },
  /** Asking for a fresh brief rather than today's cached one. */
  briefRefresh: { key: "cap_brief_refresh", limit: 8 },
} as const
