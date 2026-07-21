import { NextRequest, NextResponse } from "next/server"
import webpush from "web-push"
import { prisma } from "@/lib/prisma"
import { computeCorrelations } from "@/lib/correlations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Pin & watch: users star correlations they care about (insights_pinned). This
// cron recomputes their correlations daily and pushes a notification when a
// watched one meaningfully changes — flips direction, becomes statistically
// solid, or shifts a lot. Baselines are stored in insights_watch_state so a
// pinned correlation never re-alerts for the same state.

const WINDOW_DAYS = 90 // watch against the most-evidenced "overall" window
const BIG_CHANGE = 10  // percentage-point shift that counts as "changed"

type WatchState = Record<string, { delta: number; confident: boolean }>

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app"
  if (!publicKey || !privateKey) return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 })
  webpush.setVapidDetails(email, publicKey, privateKey)

  // One push subscription per user (most recent).
  type SubRow = { userId: string; endpoint: string; p256dh: string; auth: string }
  const subs = await prisma.$queryRaw<SubRow[]>`
    SELECT DISTINCT ON ("userId") "userId", endpoint, p256dh, auth
    FROM "PushSubscription"
    ORDER BY "userId", "createdAt" DESC
  `.catch(() => [] as SubRow[])
  if (!subs.length) return NextResponse.json({ ok: true, sent: 0 })

  const subByUser = new Map(subs.map(s => [s.userId, s]))
  const userIds = [...subByUser.keys()]

  // Pinned lists + prior watch state (all users; filtered to those with a sub).
  const prefs = await prisma.$queryRaw<{ userId: string; key: string; value: string }[]>`
    SELECT "userId", "key", "value" FROM "UserPreference"
    WHERE "key" IN ('insights_pinned', 'insights_watch_state')
  `.catch(() => [] as { userId: string; key: string; value: string }[])

  const pinnedByUser = new Map<string, string[]>()
  const stateByUser = new Map<string, WatchState>()
  for (const p of prefs) {
    if (!subByUser.has(p.userId)) continue
    try {
      if (p.key === "insights_pinned") pinnedByUser.set(p.userId, JSON.parse(p.value))
      else if (p.key === "insights_watch_state") stateByUser.set(p.userId, JSON.parse(p.value))
    } catch { /* skip malformed */ }
  }

  let sent = 0
  let checked = 0

  for (const userId of userIds) {
    const pinned = pinnedByUser.get(userId) ?? []
    if (pinned.length === 0) continue
    checked++

    let insights
    try {
      ({ insights } = await computeCorrelations(userId, WINDOW_DAYS))
    } catch {
      continue
    }
    const byId = new Map(insights.map(i => [i.id, i]))
    const prevState = stateByUser.get(userId) ?? {}
    const nextState: WatchState = { ...prevState }

    const changes: { finding: string; reason: string }[] = []
    for (const id of pinned) {
      const ins = byId.get(id)
      if (!ins) continue // not enough data this window
      const cur = { delta: ins.delta, confident: ins.confident }
      const prev = prevState[id]
      nextState[id] = cur

      if (!prev) continue // first observation — set baseline, don't alert

      const flipped = Math.sign(prev.delta) !== Math.sign(cur.delta) && Math.abs(cur.delta) >= 5
      const nowConfident = !prev.confident && cur.confident
      const bigChange = Math.abs(cur.delta - prev.delta) >= BIG_CHANGE
      let reason: string | null = null
      if (flipped) reason = "flipped direction"
      else if (nowConfident) reason = "is now statistically solid"
      else if (bigChange) reason = cur.delta > prev.delta ? "strengthened" : "weakened"
      if (reason) changes.push({ finding: ins.finding, reason })
    }

    // Persist the new baseline regardless of whether we notified.
    const stateJson = JSON.stringify(nextState)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'insights_watch_state',${stateJson})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${stateJson}
    `.catch(() => {})

    if (changes.length === 0) continue

    const sub = subByUser.get(userId)
    if (!sub) continue

    const first = changes[0]
    const body = changes.length === 1
      ? `A pattern you're watching ${first.reason}: ${first.finding}`
      : `${changes.length} patterns you're watching changed — tap to see.`

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          title: "Pattern update 📊",
          body,
          url: "/dashboard/insights",
          tag: "correlation-watch",
          requireInteraction: false,
        }),
      )
      sent++
    } catch (err: unknown) {
      if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 410) {
        await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${sub.endpoint}`.catch(() => {})
      }
    }
  }

  return NextResponse.json({ ok: true, sent, checked, users: userIds.length })
}
