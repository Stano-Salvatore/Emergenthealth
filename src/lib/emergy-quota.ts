// How many messages a day reach Emergy's model, for everyone but the owner.
//
// Every model turn is paid for by this deployment, and the app is now in the
// hands of people other than the one paying. The allowance counts only turns
// that reach the model: a quick log ("log 300ml water") or a lookup ("how was
// my sleep this week") is answered by the app itself, costs nothing, and is
// never counted or refused. Proactive messages Emergy sends on its own don't
// count either — they are not the user's to spend.
//
// The count lives in one UserPreference row per account, "day:n": a new day,
// or a value that can't be read, starts again at one. So it resets on the
// user's own midnight and the table does not grow a row a day.

import { prisma } from "@/lib/prisma"
import { userToday } from "@/lib/user-timezone"

export const DAILY_EMERGY_LIMIT = 10
const KEY = "emergy_turns"

/** The owner — FEEDBACK_NOTIFY_EMAIL, or OWNER_EMAIL — is never limited. */
export function isOwnerEmail(email: string | null | undefined): boolean {
  const owner = (process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL)?.trim().toLowerCase()
  return !!owner && !!email && email.trim().toLowerCase() === owner
}

/** Turns left today, from the stored "day:n". Another day, or a value that can't be read, is a full allowance. */
export function remainingFrom(stored: string | null, today: string): number {
  const m = stored ? /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(stored) : null
  const used = m && m[1] === today ? Number(m[2]) : 0
  return Math.max(0, DAILY_EMERGY_LIMIT - used)
}

/**
 * Today's allowance without spending any of it, for the chat to show before
 * the first message. null for the owner, who has no limit to show.
 */
export async function emergyAllowance(userId: string): Promise<{ limit: number; remaining: number } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  if (isOwnerEmail(user?.email)) return null
  const [today, row] = await Promise.all([
    userToday(userId),
    prisma.userPreference.findUnique({ where: { userId_key: { userId, key: KEY } }, select: { value: true } }),
  ])
  return { limit: DAILY_EMERGY_LIMIT, remaining: remainingFrom(row?.value ?? null, today) }
}

/**
 * What Emergy says instead, once the day's allowance is used. The quick path
 * exists only in the app's chat — Telegram sends everything to the model — so
 * from Telegram it points there rather than promising what it can't do.
 */
export function quotaReply(surface: "app" | "telegram" = "app"): string {
  const quick = `"log 300ml water", or "how was my sleep this week"`
  return `That's today's ${DAILY_EMERGY_LIMIT} messages with me — I'm back tomorrow 🌱 ` +
    (surface === "app"
      ? `Quick things still work in the meantime: ${quick}.`
      : `In the app's chat, quick things still work in the meantime: ${quick}.`)
}

/**
 * Takes one turn from today's allowance, before the model is called.
 * `allowed: false` means the model must not be: the day's turns are used.
 *
 * Read-and-write in one statement, so two messages sent at once cannot both
 * see the ninth turn. A database failure lets the message through — the hourly
 * rate limit still stands behind it, and locking someone out of a chat over a
 * counter is the worse failure.
 */
export async function claimEmergyTurn(userId: string): Promise<{ allowed: boolean; used: number | null; remaining?: number }> {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
    if (isOwnerEmail(user?.email)) return { allowed: true, used: null }

    const today = await userToday(userId)
    const first = `${today}:1`
    const rows = await prisma.$queryRaw<{ value: string }[]>`
      INSERT INTO "UserPreference" ("userId", "key", "value")
      VALUES (${userId}, ${KEY}, ${first})
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" =
        CASE WHEN split_part("UserPreference"."value", ':', 1) = ${today}
              AND split_part("UserPreference"."value", ':', 2) ~ '^[0-9]+$'
          THEN ${today} || ':' || (split_part("UserPreference"."value", ':', 2)::int + 1)::text
          ELSE ${first}
        END
      RETURNING "value"
    `
    const n = Number(/:(\d+)$/.exec(rows[0]?.value ?? "")?.[1] ?? 1)
    return { allowed: n <= DAILY_EMERGY_LIMIT, used: n, remaining: Math.max(0, DAILY_EMERGY_LIMIT - n) }
  } catch (error) {
    console.error("[emergy-quota] count failed, letting the message through", error instanceof Error ? error.message : error)
    return { allowed: true, used: null }
  }
}

/**
 * Gives back a turn the model failed to answer — an outage or an error is not
 * a message the user got, and should not cost one. Only today's count, never
 * below zero; a failure here just leaves the turn spent.
 */
export async function refundEmergyTurn(userId: string): Promise<void> {
  try {
    const today = await userToday(userId)
    await prisma.$executeRaw`
      UPDATE "UserPreference"
      SET "value" = ${today} || ':' || GREATEST(split_part("value", ':', 2)::int - 1, 0)::text
      WHERE "userId" = ${userId} AND "key" = ${KEY}
        AND split_part("value", ':', 1) = ${today}
        AND split_part("value", ':', 2) ~ '^[0-9]+$'
    `
  } catch { /* the turn stays spent */ }
}
