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

  const payload = JSON.stringify({
    title: "Good morning! 🌅",
    body: "Time for your morning check-in. How are you feeling today?",
    url: "/dashboard/checkin",
    tag: "morning-checkin",
  })

  let sent = 0

  for (const sub of subs) {
    // Get user timezone
    const tzRows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM "UserPreference" WHERE "userId" = ${sub.userId} AND key = 'timezone' LIMIT 1
    `.catch(() => [] as { value: string }[])
    const timezone = tzRows[0]?.value ?? "UTC"

    const localHour = getLocalHour(timezone)
    if (localHour !== 7) continue // Only send at 7am local time

    const localDate = getLocalDateStr(timezone)

    // Skip if already checked in today
    const checkedIn = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "MorningCheckIn"
      WHERE "userId" = ${sub.userId} AND "date"::date = ${localDate}::date
      LIMIT 1
    `.catch(() => [] as { id: string }[])
    if (checkedIn.length > 0) continue

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
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
