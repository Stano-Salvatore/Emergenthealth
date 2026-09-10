import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { configurePush, loadLocalCoverage, loadSubscriptionsByUser, phoneCovers, sendToUser } from "@/lib/push"
import { localDateStr, localTimeStr } from "@/lib/local-date"
import { readSentLog, writeSentLog } from "@/lib/sent-log"
import { sayAsEmergy } from "@/lib/emergy-say"
import { intentionQuestion } from "@/lib/checkin-mode"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Evening nudge for web-push devices, for users who checked in this morning.
// Ticked every ten minutes by the Actions cron; one delivery per day via the
// shared sent log, 21:00 local with an hour of grace.
//
// Two shapes. When the morning set an intention that has no evening answer
// yet, the push asks about THAT — "you set out to X, how did it go?" — and
// lands in the chat too, so a reply is enough to close it. Otherwise it is
// the journal nudge it always was, and only for people who haven't written.

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

    // Only remind people who showed up today — a morning check-in is the signal.
    const checkinRows = await prisma.$queryRaw<{ intention: string | null; intentionOutcome: string | null }[]>`
      SELECT "intention", "intentionOutcome" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" = ${localDate}
      LIMIT 1
    `.catch(() => [] as { intention: string | null; intentionOutcome: string | null }[])
    if (checkinRows.length === 0) continue
    const intention = checkinRows[0].intention?.trim() || null
    const askIntention = intention != null && checkinRows[0].intentionOutcome == null

    if (!askIntention) {
      // Already journalled today — nothing to nudge about.
      const noteRows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "DailyNote"
        WHERE "userId" = ${userId} AND "date"::date = ${localDate}::date
          AND "content" IS NOT NULL AND length(trim("content")) > 10
        LIMIT 1
      `.catch(() => [] as { id: string }[])
      if (noteRows.length > 0) continue
    }

    const prompt = askIntention
      ? intentionQuestion(intention!)
      : EVENING_PROMPTS[Math.floor(Math.random() * EVENING_PROMPTS.length)]

    const delivered = await sendToUser(subs, {
      title: askIntention ? "🌙 How did today go?" : "📝 Evening reflection",
      body: prompt,
      // The question opens the evening check-in, where one tap answers it;
      // the reflection opens the journal it asks for.
      url: askIntention ? "/dashboard/checkin" : "/dashboard/journal",
      tag: "evening-reflection",
    })
    if (delivered) {
      sent++
      // The question is a real question: it lands in the chat so a reply
      // there closes it too (close_intention), not only the check-in screen.
      if (askIntention) await sayAsEmergy(userId, prompt).catch(() => null)
    }

    alreadySent.add("evening")
    await writeSentLog(userId, SENT_KEY, localDate, alreadySent)
  }

  return NextResponse.json({ ok: true, sent, total: byUser.size })
}
