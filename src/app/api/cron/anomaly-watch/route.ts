import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { scanUserAnomalies } from "@/lib/anomaly-scan"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { sayAsEmergy } from "@/lib/emergy-say"
import type { Anomaly } from "@/lib/anomalies"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// "Is today unusual for me?" — pushed once, not nagged.
//
// A drift that lasts a week is one piece of news, not seven. State per metric
// and direction is kept in UserPreference so an ongoing run stays quiet unless
// it meaningfully worsens or a real gap has passed since the last mention.
// Only anomalies in the unhelpful direction interrupt anyone; a good HRV week
// is worth seeing on the Insights page, not worth a notification.

const RE_ALERT_AFTER_DAYS = 7
/** How much further out it has to move to be worth mentioning again mid-run. */
const WORSENED_BY_Z = 1
/** Two at once is a signal; five at once is noise. */
const MAX_PER_PUSH = 2

type WatchState = Record<string, { date: string; z: number }>

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()
  return Math.round(ms / 86400000)
}

function stateKey(a: Anomaly): string {
  return `${a.metric}:${a.direction}`
}

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  if (!configurePush()) {
    return NextResponse.json({ ok: true, skipped: "push not configured" })
  }

  const subsByUser = await loadSubscriptionsByUser()
  if (subsByUser.size === 0) return NextResponse.json({ ok: true, checked: 0, pushed: 0 })

  const prefs = await prisma.$queryRaw<{ userId: string; value: string }[]>`
    SELECT "userId", "value" FROM "UserPreference" WHERE "key" = 'anomaly_watch_state'
  `.catch(() => [] as { userId: string; value: string }[])
  const stateByUser = new Map<string, WatchState>()
  for (const p of prefs) {
    try { stateByUser.set(p.userId, JSON.parse(p.value)) } catch { /* skip malformed */ }
  }

  let checked = 0
  let pushed = 0

  for (const [userId, subs] of subsByUser) {
    checked++

    let anomalies: Anomaly[]
    let latestDate: string | null
    try {
      ({ anomalies, latestDate } = await scanUserAnomalies(userId))
    } catch {
      continue
    }
    if (!latestDate) continue

    const prev = stateByUser.get(userId) ?? {}
    const next: WatchState = { ...prev }

    const worth: Anomaly[] = []
    for (const a of anomalies.filter(x => x.concerning)) {
      const key = stateKey(a)
      const seen = prev[key]
      const isNew = !seen
      const longEnoughAgo = seen != null && daysBetween(seen.date, a.date) >= RE_ALERT_AFTER_DAYS
      const worsened = seen != null && Math.abs(a.z) - Math.abs(seen.z) >= WORSENED_BY_Z
      if (isNew || longEnoughAgo || worsened) {
        worth.push(a)
        next[key] = { date: a.date, z: a.z }
      }
    }

    // Clear the memory of a metric that has come back to normal, so the next
    // time it goes out it counts as news again rather than waiting out the gap.
    const stillOut = new Set(anomalies.map(stateKey))
    for (const key of Object.keys(next)) {
      if (!stillOut.has(key)) delete next[key]
    }

    const stateJson = JSON.stringify(next)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'anomaly_watch_state',${stateJson})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${stateJson}
    `.catch(() => {})

    if (worth.length === 0) continue

    const top = worth.slice(0, MAX_PER_PUSH)
    const body = top.map(a => a.summary).join(" · ")
      + (worth.length > top.length ? ` · +${worth.length - top.length} more` : "")

    const delivered = await sendToUser(subs, {
      title: `${top[0].emoji} Off your baseline`,
      body,
      url: "/dashboard/insights",
      tag: "anomaly-watch",
      requireInteraction: false,
    })
    if (delivered) {
      pushed++
      // The same words land in chat, so he knows he said them and the user can reply.
      await sayAsEmergy(userId, body).catch(() => null)
    }
  }

  return NextResponse.json({ ok: true, checked, pushed })
}
