import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import webpush from "web-push"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MESSAGES = [
  { title: "Miss you! 🌱", body: "Your health dashboard is waiting — how are you doing?" },
  { title: "Check in with yourself 🌿", body: "A quick check-in can make all the difference today." },
  { title: "Your streaks are waiting 🔥", body: "Don't let your hard work slip away — you've got this!" },
]

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app"
  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "VAPID not configured" }, { status: 503 })
  }
  webpush.setVapidDetails(email, publicKey, privateKey)

  // Find users who have push subscriptions but haven't checked in for 3+ days
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

  const inactiveUsers = await prisma.$queryRaw<{ userId: string; endpoint: string; p256dh: string; auth: string }[]>`
    SELECT DISTINCT ON (ps."userId") ps."userId", ps.endpoint, ps.p256dh, ps.auth
    FROM "PushSubscription" ps
    WHERE NOT EXISTS (
      SELECT 1 FROM "MorningCheckIn" mc
      WHERE mc."userId" = ps."userId" AND mc."date" >= ${threeDaysAgo}
    )
    AND NOT EXISTS (
      SELECT 1 FROM "HabitCompletion" hc
      WHERE hc."userId" = ps."userId" AND hc."date" >= ${threeDaysAgo}
    )
    AND NOT EXISTS (
      SELECT 1 FROM "MoodLog" ml
      WHERE ml."userId" = ps."userId" AND ml."date" >= ${threeDaysAgo}
    )
    ORDER BY ps."userId", ps."createdAt" DESC
    LIMIT 200
  `.catch(() => [] as { userId: string; endpoint: string; p256dh: string; auth: string }[])

  if (!inactiveUsers.length) return NextResponse.json({ ok: true, sent: 0 })

  const msgIndex = Math.floor(Date.now() / 86400000) % MESSAGES.length
  const { title, body } = MESSAGES[msgIndex]

  const results = await Promise.allSettled(
    inactiveUsers.map(sub =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body, url: "/dashboard/checkin", tag: "re-engagement" })
      ).catch(async (err: unknown) => {
        if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 410) {
          await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${sub.endpoint}`.catch(() => {})
        }
        throw err
      })
    )
  )

  const sent = results.filter(r => r.status === "fulfilled").length
  return NextResponse.json({ ok: true, sent, total: inactiveUsers.length })
}
