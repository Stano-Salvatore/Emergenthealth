import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import webpush from "web-push"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getLocalHour(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date())
    return parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10)
  } catch {
    return new Date().getUTCHours()
  }
}

function getLocalDateStr(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date())
  } catch {
    return new Date().toISOString().split("T")[0]
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app"
  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 503 })
  }

  webpush.setVapidDetails(email, publicKey, privateKey)

  const subs = await prisma.$queryRaw<{ endpoint: string; p256dh: string; auth: string; userId: string }[]>`
    SELECT ps."endpoint", ps."p256dh", ps."auth", ps."userId"
    FROM "PushSubscription" ps
    LIMIT 1000
  `.catch(() => [] as { endpoint: string; p256dh: string; auth: string; userId: string }[])

  if (!subs.length) return NextResponse.json({ ok: true, sent: 0 })

  let sent = 0

  for (const sub of subs) {
    // Get user timezone and preferred reminder hour
    const prefRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value" FROM "UserPreference"
      WHERE "userId" = ${sub.userId} AND "key" IN ('timezone', 'reminder_hour')
    `.catch(() => [] as { key: string; value: string }[])
    const prefMap = Object.fromEntries(prefRows.map(r => [r.key, r.value]))
    const timezone = prefMap["timezone"] ?? "UTC"
    const reminderHour = prefMap["reminder_hour"] ? parseInt(prefMap["reminder_hour"], 10) : 7

    const localHour = getLocalHour(timezone)
    if (localHour !== reminderHour) continue

    const localDate = getLocalDateStr(timezone)

    // Skip if already checked in today
    const checkedIn = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "MorningCheckIn"
      WHERE "userId" = ${sub.userId} AND "date"::date = ${localDate}::date
      LIMIT 1
    `.catch(() => [] as { id: string }[])
    if (checkedIn.length > 0) continue

    // Get streak for personalised message
    const recentCheckins = await prisma.$queryRaw<{ date: string }[]>`
      SELECT "date" FROM "MorningCheckIn"
      WHERE "userId" = ${sub.userId} AND "date" < ${localDate}
      ORDER BY "date" DESC LIMIT 30
    `.catch(() => [] as { date: string }[])
    const dateSet = new Set(recentCheckins.map(r => r.date))
    let streak = 0
    const cur = new Date(localDate)
    cur.setDate(cur.getDate() - 1)
    while (dateSet.has(cur.toISOString().slice(0, 10))) {
      streak++
      cur.setDate(cur.getDate() - 1)
    }

    const personalPayload = JSON.stringify({
      title: streak >= 3 ? `🔥 ${streak}-day streak!` : "Good morning! 🌅",
      body: streak >= 3
        ? `Don't break your ${streak}-day check-in streak! Log your energy & mood now.`
        : streak === 1
        ? "Day 2! Keep the momentum — log your morning check-in."
        : "Time for your morning check-in. How are you feeling today?",
      url: "/dashboard/checkin",
      tag: "morning-checkin",
    })

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        personalPayload
      )
      sent++
    } catch (err: unknown) {
      if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 410) {
        await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${sub.endpoint}`.catch(() => {})
      }
    }
  }

  return NextResponse.json({ ok: true, sent, total: subs.length })
}
