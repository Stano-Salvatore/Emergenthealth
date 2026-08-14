import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { getUserTimezone, localDateStr, localTimeStr } from "@/lib/local-date"
import { readSentLog, writeSentLog } from "@/lib/sent-log"

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

  // Find users who have push subscriptions but haven't checked in for 3+ days.
  // Bound as a YYYY-MM-DD string: MorningCheckIn.date is a text column, and
  // comparing it against a bound timestamp has no operator in Postgres — the
  // old Date parameter made this whole query error on every run, silently
  // returning nobody. The date-typed columns get an explicit ::date cast.
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const inactiveUsers = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT DISTINCT ps."userId"
    FROM "PushSubscription" ps
    WHERE NOT EXISTS (
      SELECT 1 FROM "MorningCheckIn" mc
      WHERE mc."userId" = ps."userId" AND mc."date" >= ${threeDaysAgo}
    )
    AND NOT EXISTS (
      SELECT 1 FROM "HabitCompletion" hc
      WHERE hc."userId" = ps."userId" AND hc."date" >= ${threeDaysAgo}::date
    )
    AND NOT EXISTS (
      SELECT 1 FROM "MoodLog" ml
      WHERE ml."userId" = ps."userId" AND ml."date" >= ${threeDaysAgo}::date
    )
    LIMIT 200
  `.catch(() => [] as { userId: string }[])

  if (!inactiveUsers.length) return NextResponse.json({ ok: true, sent: 0 })

  const msgIndex = Math.floor(Date.now() / 86400000) % MESSAGES.length
  const { title, body } = MESSAGES[msgIndex]

  const subsByUser = await loadSubscriptionsByUser(inactiveUsers.map(u => u.userId))

  // At most one nudge per user per day, whatever schedule this ends up on —
  // without the guard, anything more frequent than daily would ping the same
  // inactive users on every single run.
  let sent = 0
  for (const [userId, subs] of subsByUser) {
    const timezone = await getUserTimezone(userId)

    // The sent log resets at local midnight, so without an hour gate the
    // first tick after 00:00 would deliver "Miss you!" in the middle of the
    // night. Daytime only.
    const localHour = parseInt(localTimeStr(timezone).slice(0, 2), 10)
    if (localHour < 10 || localHour >= 20) continue

    const localDate = localDateStr(timezone)
    const alreadySent = await readSentLog(userId, "re_engagement_sent", localDate)
    if (alreadySent.has("re-engagement")) continue

    const delivered = await sendToUser(subs, { title, body, url: "/dashboard/checkin", tag: "re-engagement" })
    if (delivered) sent++

    alreadySent.add("re-engagement")
    await writeSentLog(userId, "re_engagement_sent", localDate, alreadySent)
  }

  return NextResponse.json({ ok: true, sent, total: inactiveUsers.length })
}
