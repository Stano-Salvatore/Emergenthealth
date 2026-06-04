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

const EVENING_PROMPTS = [
  "End the day right — write a quick reflection in your journal.",
  "What went well today? Take 2 minutes to write it down.",
  "Your daily note awaits — capture your wins and learnings.",
  "Before you wind down — what's one thing you learned today?",
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
      WHERE "userId" = ${sub.userId} AND "key" IN ('timezone', 'evening_reminder_enabled')
    `.catch(() => [] as { key: string; value: string }[])
    const prefMap = Object.fromEntries(prefRows.map(r => [r.key, r.value]))
    const timezone = prefMap["timezone"] ?? "UTC"

    // Default enabled (only disabled if explicitly set to false)
    if (prefMap["evening_reminder_enabled"] === "false") continue

    const localHour = getLocalHour(timezone)
    if (localHour !== 21) continue // Only at 9pm local time

    const localDate = getLocalDateStr(timezone)

    // Skip if already wrote a journal entry today
    const noteRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "DailyNote"
      WHERE "userId" = ${sub.userId} AND "date"::date = ${localDate}::date
        AND "content" IS NOT NULL AND length(trim("content")) > 10
      LIMIT 1
    `.catch(() => [] as { id: string }[])
    if (noteRows.length > 0) continue

    // Check if user had a check-in today (only remind active users)
    const checkinRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "MorningCheckIn"
      WHERE "userId" = ${sub.userId} AND "date"::date = ${localDate}::date
      LIMIT 1
    `.catch(() => [] as { id: string }[])
    if (checkinRows.length === 0) continue // Don't bother if they didn't check in

    const prompt = EVENING_PROMPTS[Math.floor(Math.random() * EVENING_PROMPTS.length)]

    const payload = JSON.stringify({
      title: "📝 Evening reflection",
      body: prompt,
      url: "/dashboard/journal",
      tag: "evening-reflection",
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
