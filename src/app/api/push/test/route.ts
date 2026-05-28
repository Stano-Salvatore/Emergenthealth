import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import webpush from "web-push"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app"
  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "Push notifications not configured. Add VAPID keys to environment variables." }, { status: 503 })
  }

  webpush.setVapidDetails(email, publicKey, privateKey)

  const subs = await prisma.$queryRaw<{ endpoint: string; p256dh: string; auth: string }[]>`
    SELECT "endpoint", "p256dh", "auth" FROM "PushSubscription" WHERE "userId" = ${userId} LIMIT 10
  `.catch(() => [] as { endpoint: string; p256dh: string; auth: string }[])

  if (subs.length === 0) {
    return NextResponse.json({ error: "No subscriptions found" }, { status: 404 })
  }

  const payload = JSON.stringify({
    title: "Emergenthealth",
    body: "Push notifications are working! ✅",
    url: "/dashboard",
    tag: "test",
  })

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      )
    )
  )

  const sent = results.filter((r) => r.status === "fulfilled").length
  return NextResponse.json({ ok: true, sent })
}
