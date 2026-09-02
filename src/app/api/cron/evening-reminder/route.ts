import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { configurePush, loadLocalCoverage, loadSubscriptionsByUser, phoneCovers, sendToUser } from "@/lib/push"
import { localDateStr, localTimeStr } from "@/lib/local-date"
import { readSentLog, writeSentLog } from "@/lib/sent-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Evening journal nudge for web-push devices, for users who checked in this
// morning but haven't written anything yet. Ticked every ten minutes by the
// Actions cron; one delivery per day via the shared sent log, 21:00 local
// with an hour of grace.

const SENT_KEY = "daily_nudges_sent"

const EVENING_PROMPTS = [
  "End the day right — write a quick reflection in your journal.",
  "What went well today? Take 2 minutes to write it down.",
  "Your daily note awaits — capture your wins and learnings.",
  "Before you wind down — what's one thing you learned today?",
]

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  if (!configurePush()) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 503 })
  }

  const byUser = await loadSubscriptionsByUser()
  const coverage = await loadLocalCoverage()
  if (byUser.size === 0) return NextResponse.json({ ok: true, sent: 0 })

  // One query for every user's prefs, not two per user per tick — this runs
  // every ten minutes against mostly out-of-window users.
  const userIds = [...byUser.keys()]
  const prefRows = await prisma.userPreference.findMany({
    where: { userId: { in: userIds }, key: { in: ["timezone", "evening_reminder_enabled"] } },
    select: { userId: true, key: true, value: true },
  }).catch(() => [])
  const prefs = new Map<string, Record<string, string>>()
  for (const r of prefRows) {
    const m = prefs.get(r.userId) ?? {}
    m[r.key] = r.value
    prefs.set(r.userId, m)
  }

  let sent = 0

  for (const [userId, subs] of byUser) {
    // The phone already laid this down locally at the exact time. Two
    // notifications for one nudge is worse than either alone; the push resumes
    // by itself once the local window runs dry.
    if (phoneCovers(coverage, userId)) continue

    if (prefs.get(userId)?.["evening_reminder_enabled"] === "false") continue

    const timezone = prefs.get(userId)?.["timezone"]?.trim() || "UTC"
    const localHour = parseInt(localTimeStr(timezone).slice(0, 2), 10)
    if (localHour !== 21 && localHour !== 22) continue

    const localDate = localDateStr(timezone)

    const alreadySent = await readSentLog(userId, SENT_KEY, localDate)
    if (alreadySent.has("evening")) continue

    // Already journalled today — nothing to nudge about.
    const noteRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "DailyNote"
      WHERE "userId" = ${userId} AND "date"::date = ${localDate}::date
        AND "content" IS NOT NULL AND length(trim("content")) > 10
      LIMIT 1
    `.catch(() => [] as { id: string }[])
    if (noteRows.length > 0) continue

    // Only remind people who showed up today — a morning check-in is the signal.
    const checkinRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" = ${localDate}
      LIMIT 1
    `.catch(() => [] as { id: string }[])
    if (checkinRows.length === 0) continue

    const prompt = EVENING_PROMPTS[Math.floor(Math.random() * EVENING_PROMPTS.length)]

    const delivered = await sendToUser(subs, {
      title: "📝 Evening reflection",
      body: prompt,
      url: "/dashboard/journal",
      tag: "evening-reflection",
    })
    if (delivered) sent++

    alreadySent.add("evening")
    await writeSentLog(userId, SENT_KEY, localDate, alreadySent)
  }

  return NextResponse.json({ ok: true, sent, total: byUser.size })
}
