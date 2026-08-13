import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"

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

  if (!configurePush()) {
    return NextResponse.json({ error: "VAPID not configured" }, { status: 503 })
  }

  // Find users who have push subscriptions but haven't checked in for 3+ days
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)

  const inactiveUsers = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT DISTINCT ps."userId"
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
    LIMIT 200
  `.catch(() => [] as { userId: string }[])

  if (!inactiveUsers.length) return NextResponse.json({ ok: true, sent: 0 })

  const msgIndex = Math.floor(Date.now() / 86400000) % MESSAGES.length
  const { title, body } = MESSAGES[msgIndex]

  const subsByUser = await loadSubscriptionsByUser(inactiveUsers.map(u => u.userId))

  const results = await Promise.all(
    [...subsByUser.values()].map(subs =>
      sendToUser(subs, { title, body, url: "/dashboard/checkin", tag: "re-engagement" }),
    ),
  )

  const sent = results.filter(Boolean).length
  return NextResponse.json({ ok: true, sent, total: inactiveUsers.length })
}
