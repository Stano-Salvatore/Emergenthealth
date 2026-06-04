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
    const prefRows = await prisma.$queryRaw<{ key: string; value: string }[]>`
      SELECT "key", "value" FROM "UserPreference"
      WHERE "userId" = ${sub.userId} AND "key" IN ('timezone', 'noon_reminder_enabled')
    `.catch(() => [] as { key: string; value: string }[])
    const prefMap = Object.fromEntries(prefRows.map(r => [r.key, r.value]))
    const timezone = prefMap["timezone"] ?? "UTC"
    if (prefMap["noon_reminder_enabled"] === "false") continue

    const localHour = getLocalHour(timezone)
    if (localHour !== 12) continue // Only send at noon local time

    const localDate = getLocalDateStr(timezone)

    // Only send if user has a morning check-in with an intention today
    const checkinRows = await prisma.$queryRaw<{ intention: string | null; energy: number }[]>`
      SELECT "intention", "energy" FROM "MorningCheckIn"
      WHERE "userId" = ${sub.userId} AND "date"::date = ${localDate}::date
      LIMIT 1
    `.catch(() => [] as { intention: string | null; energy: number }[])

    if (checkinRows.length === 0) continue // No check-in today

    const checkin = checkinRows[0]
    if (!checkin.intention?.trim()) continue // No intention set

    const intention = checkin.intention.trim()
    const energyHigh = checkin.energy >= 4

    const payload = JSON.stringify({
      title: energyHigh ? "⚡ Midday check-in" : "🌤️ Midday check-in",
      body: `Your intention for today: "${intention}" — staying on track?`,
      url: "/dashboard/chat",
      tag: "noon-intention",
    })

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
