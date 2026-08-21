// Sending a push to a person, rather than to one of their devices.
//
// Several crons picked their recipient with `SELECT DISTINCT ON ("userId")
// ... ORDER BY "createdAt" DESC` — one subscription per user, the most
// recently registered. On a single-device account that looks correct. The
// moment someone enables notifications on a second device it stops being: the
// new device becomes "the" subscription and the old one goes silent, with
// nothing anywhere saying so. Enabling notifications on a laptop would quietly
// stop medication reminders reaching the phone.
//
// A notification belongs to the person. It goes to every device they have
// registered, and the per-user dedupe state each cron already keeps is what
// stops one event becoming several — not the accident of only knowing about
// one device.

import webpush from "web-push"
import { prisma } from "@/lib/prisma"
import { localCoversNow, parseCoverage, type LocalCoverage } from "@/lib/local-notifications"

export interface PushSub {
  userId: string
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  requireInteraction?: boolean
}

/** Set up VAPID. False when push isn't configured, so callers can bail early. */
export function configurePush(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app",
    publicKey,
    privateKey,
  )
  return true
}

/**
 * Every registered device, grouped by user. Pass `userIds` to narrow it;
 * omit to load everyone.
 */
export async function loadSubscriptionsByUser(userIds?: string[]): Promise<Map<string, PushSub[]>> {
  const rows = userIds
    ? await prisma.$queryRaw<PushSub[]>`
        SELECT "userId", endpoint, p256dh, auth FROM "PushSubscription"
        WHERE "userId" = ANY(${userIds}::text[])
      `.catch(() => [] as PushSub[])
    : await prisma.$queryRaw<PushSub[]>`
        SELECT "userId", endpoint, p256dh, auth FROM "PushSubscription"
      `.catch(() => [] as PushSub[])

  const byUser = new Map<string, PushSub[]>()
  for (const r of rows) {
    const list = byUser.get(r.userId)
    if (list) list.push(r)
    else byUser.set(r.userId, [r])
  }
  return byUser
}

/**
 * Deliver one notification to all of a user's devices.
 *
 * Returns true when at least one device took it. A 410 means the browser has
 * thrown the subscription away — that endpoint is deleted rather than retried
 * forever, which is also how a stale laptop registration eventually clears
 * itself up.
 */
export async function sendToUser(subs: PushSub[], payload: PushPayload): Promise<boolean> {
  if (subs.length === 0) return false
  const json = JSON.stringify(payload)

  const results = await Promise.allSettled(
    subs.map(sub =>
      webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, json)
        .catch(async (err: unknown) => {
          if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 410) {
            await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${sub.endpoint}`.catch(() => {})
          }
          throw err
        }),
    ),
  )

  return results.some(r => r.status === "fulfilled")
}

/**
 * Which users' phones already have their notifications scheduled locally.
 *
 * The native app lays down local notifications on a rolling window; the server
 * crons push for the same things. Both land — different ids — so the phone
 * buzzes twice for one nudge. habit-reminders has gated on this since it was
 * written; morning, noon, evening and med did not, which is why a phone with
 * the app installed still got a second morning check-in through the browser.
 *
 * One query per tick rather than one per user: these run every ten minutes
 * against mostly out-of-window users.
 */
export async function loadLocalCoverage(): Promise<Map<string, LocalCoverage>> {
  const rows = await prisma.$queryRaw<{ userId: string; value: string }[]>`
    SELECT "userId", "value" FROM "UserPreference" WHERE "key" = 'local_notifications_synced'
  `.catch(() => [] as { userId: string; value: string }[])
  return new Map(rows.map(r => [r.userId, parseCoverage(r.value)]))
}

/** True when the phone has this user covered right now, so the server stays quiet. */
export function phoneCovers(coverage: Map<string, LocalCoverage>, userId: string): boolean {
  return localCoversNow(coverage.get(userId) ?? { syncedAt: null, windowDays: null })
}
