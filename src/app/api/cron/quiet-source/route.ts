import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { sayAsEmergy } from "@/lib/emergy-say"
import { localDateStr, localTimeStr } from "@/lib/local-date"
import { readSyncStatus } from "@/lib/sync-status-store"
import { judgeQuietSource, parseNotified, NOTIFIED_KEY } from "@/lib/quiet-source"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The ring-gone-quiet nudge. Runs on the ten-minute reminder loop; the judge
// in lib/quiet-source.ts is what keeps that from becoming ten-minute nagging
// — one push per quiet spell, daytime only. See the note there for why this
// is Oura-only.
export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  if (!configurePush()) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 503 })
  }

  const tokens = await prisma.ouraToken.findMany({ select: { userId: true } }).catch(() => [] as { userId: string }[])
  if (tokens.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  const userIds = tokens.map(t => t.userId)
  const [byUser, prefRows] = await Promise.all([
    loadSubscriptionsByUser(userIds),
    prisma.userPreference.findMany({
      where: { userId: { in: userIds }, key: { in: ["timezone", NOTIFIED_KEY] } },
      select: { userId: true, key: true, value: true },
    }).catch(() => [] as { userId: string; key: string; value: string }[]),
  ])
  const prefs = new Map<string, Record<string, string>>()
  for (const r of prefRows) {
    const m = prefs.get(r.userId) ?? {}
    m[r.key] = r.value
    prefs.set(r.userId, m)
  }

  let sent = 0
  for (const userId of userIds) {
    // No device to reach: nothing to judge.
    const delivery = byUser.get(userId)
    if (!delivery) continue

    const timezone = prefs.get(userId)?.["timezone"]?.trim() || "UTC"
    const localHour = parseInt(localTimeStr(timezone).slice(0, 2), 10)
    if (localHour < 10 || localHour >= 20) continue

    const [newest, status] = await Promise.all([
      prisma.healthLog.findFirst({
        where: { userId, sleepDuration: { not: null } },
        orderBy: { date: "desc" },
        select: { date: true },
      }).catch(() => null),
      readSyncStatus(userId),
    ])

    const nudge = judgeQuietSource({
      today: localDateStr(timezone),
      localHour,
      // A @db.Date column comes back at UTC midnight, so the slice is exact.
      newestSleepDay: newest ? newest.date.toISOString().slice(0, 10) : null,
      lastRun: status.oura ?? null,
      notified: parseNotified(prefs.get(userId)?.[NOTIFIED_KEY]),
    })
    if (!nudge) continue

    const delivered = await sendToUser(delivery, {
      title: "Emergy 🌱",
      body: nudge.body,
      url: "/dashboard/settings",
      tag: "quiet-source",
    })
    if (delivered) {
      sent++
      await sayAsEmergy(userId, nudge.body).catch(() => null)
    }

    // Recorded whether or not a device took it, like every other sent log:
    // a dead subscription must not be retried every ten minutes all day.
    const value = JSON.stringify({ key: nudge.key, at: new Date().toISOString() })
    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: NOTIFIED_KEY } },
      create: { userId, key: NOTIFIED_KEY, value },
      update: { value },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, sent, users: userIds.length })
}
