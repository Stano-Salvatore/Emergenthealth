import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { sayAsEmergy } from "@/lib/emergy-say"
import { localDateStr, localTimeStr } from "@/lib/local-date"
import { readSentLog, writeSentLog } from "@/lib/sent-log"
import { calendarWindows, loadDriftReport } from "@/lib/drift-load"
import { renderDrift } from "@/lib/drift"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// Month against month, on the first of the month. Ticked every ten minutes
// by the Actions reminders cron; gated to the 1st, daytime, in the user's own
// timezone, once via the sent log. Says nothing when nothing moved — a
// monthly "everything is the same" is a notification people learn to swipe.
// See lib/drift.ts for the test each shift has to pass.

const SENT_KEY = "daily_nudges_sent"
const SENT_ID = "monthly-drift"

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  if (!configurePush()) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 503 })
  }

  const byUser = await loadSubscriptionsByUser()
  if (byUser.size === 0) return NextResponse.json({ ok: true, sent: 0 })

  const userIds = [...byUser.keys()]
  const tzRows = await prisma.userPreference.findMany({
    where: { userId: { in: userIds }, key: "timezone" },
    select: { userId: true, value: true },
  }).catch(() => [] as { userId: string; value: string }[])
  const tzByUser = new Map(tzRows.map(r => [r.userId, r.value.trim() || "UTC"]))

  let sent = 0
  for (const [userId, subs] of byUser) {
    const timezone = tzByUser.get(userId) ?? "UTC"
    const localDate = localDateStr(timezone)
    if (!localDate.endsWith("-01")) continue
    const localHour = parseInt(localTimeStr(timezone).slice(0, 2), 10)
    if (localHour < 10 || localHour >= 20) continue

    const alreadySent = await readSentLog(userId, SENT_KEY, localDate)
    if (alreadySent.has(SENT_ID)) continue

    let text: ReturnType<typeof renderDrift> = null
    try {
      const report = await loadDriftReport(userId, timezone, calendarWindows(localDate))
      text = renderDrift(report, { calendarMonths: true })
    } catch (e) {
      console.error("[cron/monthly-drift] failed for", userId, e)
    }
    // Recorded either way: a month with nothing to say is done for the month.
    alreadySent.add(SENT_ID)
    await writeSentLog(userId, SENT_KEY, localDate, alreadySent)
    if (!text) continue

    const delivered = await sendToUser(subs, {
      title: "📅 Last month vs the one before",
      body: text.headline,
      url: "/dashboard/chat",
      tag: "monthly-drift",
    })
    if (delivered) {
      sent++
      await sayAsEmergy(userId, text.headline).catch(() => null)
    }
  }

  return NextResponse.json({ ok: true, sent, users: userIds.length })
}
