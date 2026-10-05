// How many messages a day reach Emergy's model, for everyone but the owner.
//
// Every model turn is paid for by this deployment, and the app is now in the
// hands of people other than the one paying. The allowance counts only turns
// that reach the model: a quick log ("log 300ml water") or a lookup ("how was
// my sleep this week") is answered by the app itself, costs nothing, and is
// never counted or refused. Proactive messages Emergy sends on its own don't
// count either — they are not the user's to spend. The garden's Emergy is
// the same Emergy on the same bill, so it spends the same allowance.
//
// The count itself is lib/daily-cap's: one row per account, reset on the
// user's own midnight.

import { claimDailyUse, dailyRemaining, refundDailyUse, remainingFrom as capRemaining } from "@/lib/daily-cap"

export { isOwnerEmail } from "@/lib/daily-cap"

export const DAILY_EMERGY_LIMIT = 10
const KEY = "emergy_turns"

/** Turns left today, from the stored "day:n". Another day, or a value that can't be read, is a full allowance. */
export function remainingFrom(stored: string | null, today: string): number {
  return capRemaining(stored, today, DAILY_EMERGY_LIMIT)
}

/**
 * Today's allowance without spending any of it, for the chat to show before
 * the first message. null for the owner, who has no limit to show.
 */
export async function emergyAllowance(userId: string): Promise<{ limit: number; remaining: number } | null> {
  const remaining = await dailyRemaining(userId, KEY, DAILY_EMERGY_LIMIT)
  return remaining === null ? null : { limit: DAILY_EMERGY_LIMIT, remaining }
}

/**
 * What Emergy says instead, once the day's allowance is used. The quick path
 * exists only in the app's chat — Telegram and the garden send everything to
 * the model — so from those it points there rather than promising what it
 * can't do.
 */
export function quotaReply(surface: "app" | "telegram" | "garden" = "app"): string {
  const quick = `"log 300ml water", or "how was my sleep this week"`
  return `That's today's ${DAILY_EMERGY_LIMIT} messages with me — I'm back tomorrow 🌱 ` +
    (surface === "app"
      ? `Quick things still work in the meantime: ${quick}.`
      : `In the app's chat, quick things still work in the meantime: ${quick}.`)
}

/**
 * Takes one turn from today's allowance, before the model is called.
 * `allowed: false` means the model must not be: the day's turns are used.
 * Atomic, and open on a database failure — see lib/daily-cap.
 */
export function claimEmergyTurn(userId: string): Promise<{ allowed: boolean; used: number | null; remaining?: number }> {
  return claimDailyUse(userId, KEY, DAILY_EMERGY_LIMIT)
}

/**
 * Gives back a turn the model failed to answer — an outage or an error is not
 * a message the user got, and should not cost one.
 */
export function refundEmergyTurn(userId: string): Promise<void> {
  return refundDailyUse(userId, KEY)
}
