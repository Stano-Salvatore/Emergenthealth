import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { configurePush, loadLocalCoverage, loadSubscriptionsByUser, phoneCovers, sendToUser } from "@/lib/push"
import { localDateStr, localTimeStr } from "@/lib/local-date"
import { readSentLog, writeSentLog } from "@/lib/sent-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The morning check-in nudge for web-push devices — browsers and PWAs, which
// can't lay down local notifications the way the phone app does. Ticked every
// ten minutes by the Actions cron alongside the other reminder jobs; the
// per-day sent log makes extra ticks free, and one hour of grace after the
// user's chosen hour means a delayed tick still delivers rather than skipping
// the day.

const SENT_KEY = "daily_nudges_sent"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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
    where: { userId: { in: userIds }, key: { in: ["timezone", "reminder_hour"] } },
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

    const timezone = prefs.get(userId)?.["timezone"]?.trim() || "UTC"
    const hourPref = prefs.get(userId)?.["reminder_hour"]
    const reminderHour = hourPref ? parseInt(hourPref, 10) : 7

    // The grace hour never crosses midnight: for an hour-23 nudge it would
    // land on the next local date, marking tomorrow's log and eating
    // tomorrow's nudge, so 23 simply gets no grace.
    const localHour = parseInt(localTimeStr(timezone).slice(0, 2), 10)
    if (localHour !== reminderHour && localHour !== Math.min(reminderHour + 1, 23)) continue

    const localDate = localDateStr(timezone)

    const alreadySent = await readSentLog(userId, SENT_KEY, localDate)
    if (alreadySent.has("morning")) continue

    // Already checked in — the nudge has nothing left to ask for.
    const checkedIn = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" = ${localDate}
      LIMIT 1
    `.catch(() => [] as { id: string }[])
    if (checkedIn.length > 0) continue

    // Streak of consecutive days ending yesterday, for the personalised copy.
    const recentCheckins = await prisma.$queryRaw<{ date: string }[]>`
      SELECT "date" FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" < ${localDate}
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

    const delivered = await sendToUser(subs, {
      title: streak >= 3 ? `🔥 ${streak}-day streak!` : "Good morning! 🌅",
      body: streak >= 3
        ? `Don't break your ${streak}-day check-in streak! Log your energy & mood now.`
        : streak === 1
        ? "Day 2! Keep the momentum — log your morning check-in."
        : "Time for your morning check-in. How are you feeling today?",
      url: "/dashboard/checkin",
      tag: "morning-checkin",
    })
    if (delivered) sent++

    alreadySent.add("morning")
    await writeSentLog(userId, SENT_KEY, localDate, alreadySent)
  }

  return NextResponse.json({ ok: true, sent, total: byUser.size })
}
