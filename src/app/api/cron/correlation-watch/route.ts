import { NextRequest, NextResponse } from "next/server"
import webpush from "web-push"
import { Resend } from "resend"
import { prisma } from "@/lib/prisma"
import { computeCorrelations } from "@/lib/correlations"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Pin & watch: users star correlations they care about (insights_pinned). This
// cron recomputes their correlations daily and alerts them — by push AND email,
// whichever is configured — when a watched one meaningfully changes (flips
// direction, becomes statistically solid, or shifts a lot). Baselines are stored
// in insights_watch_state so a pinned correlation never re-alerts for the same
// state. Keyed off pinned lists (not push subs) so email-only users are covered.

const WINDOW_DAYS = 90 // watch against the most-evidenced "overall" window
const BIG_CHANGE = 10  // percentage-point shift that counts as "changed"

type WatchState = Record<string, { delta: number; confident: boolean }>
type Change = { finding: string; reason: string }

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ))
}

function buildEmail(name: string | null, changes: Change[], appUrl: string): string {
  const rows = changes
    .map(c => `<li style="margin-bottom:10px"><strong>${cap(c.reason)}</strong> — ${escapeHtml(c.finding)}</li>`)
    .join("")
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;color:#0f0f1a">
    <h2 style="font-size:18px;margin:0 0 4px">📊 Your watched patterns changed</h2>
    <p style="color:#555;font-size:14px;margin:0 0 16px">Hi ${escapeHtml(name ?? "there")}, here's an update on the correlations you're watching:</p>
    <ul style="padding-left:18px;font-size:14px;color:#333;line-height:1.5">${rows}</ul>
    <p style="margin-top:20px"><a href="${appUrl}/dashboard/insights" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px">View on your dashboard →</a></p>
    <p style="color:#999;font-size:11px;margin-top:24px">You're receiving this because you pinned these patterns to watch. Un-star them on the Insights page to stop.</p>
  </div>`
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  // Pinned lists + prior watch state for every user.
  const prefs = await prisma.$queryRaw<{ userId: string; key: string; value: string }[]>`
    SELECT "userId", "key", "value" FROM "UserPreference"
    WHERE "key" IN ('insights_pinned', 'insights_watch_state')
  `.catch(() => [] as { userId: string; key: string; value: string }[])

  const pinnedByUser = new Map<string, string[]>()
  const stateByUser = new Map<string, WatchState>()
  for (const p of prefs) {
    try {
      if (p.key === "insights_pinned") pinnedByUser.set(p.userId, JSON.parse(p.value))
      else if (p.key === "insights_watch_state") stateByUser.set(p.userId, JSON.parse(p.value))
    } catch { /* skip malformed */ }
  }

  const userIds = [...pinnedByUser.entries()].filter(([, arr]) => arr.length > 0).map(([id]) => id)
  if (userIds.length === 0) return NextResponse.json({ ok: true, checked: 0, pushed: 0, emailed: 0 })

  // ── Channels ──
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const pushReady = !!(publicKey && privateKey)
  if (pushReady) {
    webpush.setVapidDetails(process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app", publicKey!, privateKey!)
  }

  type SubRow = { userId: string; endpoint: string; p256dh: string; auth: string }
  const subs = pushReady
    ? await prisma.$queryRaw<SubRow[]>`
        SELECT DISTINCT ON ("userId") "userId", endpoint, p256dh, auth
        FROM "PushSubscription"
        ORDER BY "userId", "createdAt" DESC
      `.catch(() => [] as SubRow[])
    : []
  const subByUser = new Map(subs.map(s => [s.userId, s]))

  const users = await prisma.user
    .findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, name: true } })
    .catch(() => [] as { id: string; email: string | null; name: string | null }[])
  const userById = new Map(users.map(u => [u.id, u]))

  const resendKey = process.env.RESEND_API_KEY
  const resend = resendKey ? new Resend(resendKey) : null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? "https://emergenthealth.vercel.app"

  let pushed = 0
  let emailed = 0
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

    const changes: Change[] = []
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

    const first = changes[0]
    const body = changes.length === 1
      ? `A pattern you're watching ${first.reason}: ${first.finding}`
      : `${changes.length} patterns you're watching changed — tap to see.`

    // ── Push ──
    const sub = subByUser.get(userId)
    if (sub) {
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
        pushed++
      } catch (err: unknown) {
        if (err && typeof err === "object" && "statusCode" in err && (err as { statusCode: number }).statusCode === 410) {
          await prisma.$executeRaw`DELETE FROM "PushSubscription" WHERE endpoint = ${sub.endpoint}`.catch(() => {})
        }
      }
    }

    // ── Email ──
    const u = userById.get(userId)
    if (resend && u?.email) {
      try {
        await resend.emails.send({
          from: "Emergenthealth <onboarding@resend.dev>",
          to: u.email,
          subject: `📊 ${changes.length} watched pattern${changes.length === 1 ? "" : "s"} changed`,
          html: buildEmail(u.name, changes, appUrl),
        })
        emailed++
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({ ok: true, checked, pushed, emailed, users: userIds.length })
}
