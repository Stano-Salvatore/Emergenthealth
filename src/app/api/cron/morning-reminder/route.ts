import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import webpush from "web-push"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app"
  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 503 })
  }

  webpush.setVapidDetails(email, publicKey, privateKey)

  const subs = await prisma.$queryRaw<{ endpoint: string; p256dh: string; auth: string }[]>`
    SELECT "endpoint", "p256dh", "auth" FROM "PushSubscription" LIMIT 1000
  `.catch(() => [] as { endpoint: string; p256dh: string; auth: string }[])

  const payload = JSON.stringify({
    title: "Good morning! 🌅",
    body: "Time for your morning check-in. How are you feeling today?",
    url: "/dashboard/checkin",
    tag: "morning-checkin",
  })

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      ).catch(async (err) => {
        // Clean up expired subscriptions
        if (err.statusCode === 410) {
          await prisma.$executeRaw`
            DELETE FROM "PushSubscription" WHERE "endpoint" = ${sub.endpoint}
          `.catch(() => {})
        }
        throw err
      })
    )
  )

  const sent = results.filter((r) => r.status === "fulfilled").length
  return NextResponse.json({ ok: true, sent, total: subs.length })
}
