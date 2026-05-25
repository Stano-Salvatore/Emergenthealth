import webpush from "web-push"
import { prisma } from "@/lib/prisma"

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

interface PushRow { endpoint: string; p256dh: string; auth: string }

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url?: string }
) {
  const subs = await prisma.$queryRaw<PushRow[]>`
    SELECT endpoint, p256dh, auth FROM "PushSubscription" WHERE "userId" = ${userId}
  `.catch(() => [] as PushRow[])

  await Promise.allSettled(
    subs.map((sub) =>
      webpush
        .sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        )
        .catch((err: { statusCode?: number }) => {
          if (err.statusCode === 410) {
            prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${sub.endpoint}`.catch(() => {})
          }
        })
    )
  )
}
