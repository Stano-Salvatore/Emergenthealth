import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { prisma } from "@/lib/prisma"
import { configurePush, loadSubscriptionsByUser, sendToUser, type Delivery } from "@/lib/push"
import { computeCorrelations, ENGINE_VERSION } from "@/lib/correlations"

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

type WatchState = Record<string, { delta: number; confident: boolean; tier?: string }>
type Change = { finding: string; reason: string }

// A pattern only "graduates" once: from anything weaker to Solid, meaning it
// survived the permutation test and the false-discovery correction across the
// whole run. That's the moment worth interrupting someone for.
const GRADUATION_LIMIT = 3

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
    <h2 style="font-size:18px;margin:0 0 4px">📊 Your patterns moved</h2>
    <p style="color:#555;font-size:14px;margin:0 0 16px">Hi ${escapeHtml(name ?? "there")}, here's what changed in your correlations — including any that just became statistically solid:</p>
    <ul style="padding-left:18px;font-size:14px;color:#333;line-height:1.5">${rows}</ul>
    <p style="margin-top:20px"><a href="${appUrl}/dashboard/insights" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:8px">View on your dashboard →</a></p>
    <p style="color:#999;font-size:11px;margin-top:24px">You're receiving this because you pinned patterns to watch, or because one of your patterns reached the solid threshold. Un-star them on the Insights page to stop.</p>
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

  // ── Channels ──
  const pushReady = configurePush()
  const subsByUser: Map<string, Delivery> = pushReady
    ? await loadSubscriptionsByUser()
    : new Map()

  // Pinning is opt-in per pattern, but a pattern reaching Solid is news even
  // for someone who never pinned anything — so anyone reachable (pinned list,
  // push subscription, or a state baseline from a previous run) is checked.
  const userIds = [...new Set([
    ...[...pinnedByUser.entries()].filter(([, arr]) => arr.length > 0).map(([id]) => id),
    ...subsByUser.keys(),
    ...stateByUser.keys(),
  ])]
  if (userIds.length === 0) return NextResponse.json({ ok: true, checked: 0, pushed: 0, emailed: 0 })

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
    checked++

    let insights
    let totalDays = 0
    try {
      ({ insights, totalDays } = await computeCorrelations(userId, WINDOW_DAYS))
    } catch {
      continue
    }

    // This run has already paid for the expensive part, so store it where the
    // rest of the app can read it. Same key and shape the insights page uses,
    // so both readers agree and the page loads from cache the next morning —
    // and Emergy can see these patterns without a chat message triggering a
    // 1000-permutation recompute.
    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: "insights_cache:overall" } },
      create: {
        userId, key: "insights_cache:overall",
        value: JSON.stringify({ at: Date.now(), v: ENGINE_VERSION, payload: { insights, dataRange: { days: totalDays } } }),
      },
      update: {
        value: JSON.stringify({ at: Date.now(), v: ENGINE_VERSION, payload: { insights, dataRange: { days: totalDays } } }),
      },
    }).catch(() => null)
    const byId = new Map(insights.map(i => [i.id, i]))
    const prevState = stateByUser.get(userId) ?? {}
    const nextState: WatchState = { ...prevState }

    const changes: Change[] = []

    // Newly Solid patterns, pinned or not. Recorded for every insight so the
    // baseline covers the whole board; only a move up to Solid is announced,
    // and never on the first run for an insight (no baseline = no news).
    const graduated = insights
      .filter(ins => {
        const prevTier = prevState[ins.id]?.tier
        return prevTier != null && prevTier !== "strong" && ins.tier === "strong"
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, GRADUATION_LIMIT)
    for (const ins of graduated) {
      changes.push({ finding: ins.finding, reason: "is now a solid pattern" })
    }
    for (const ins of insights) {
      nextState[ins.id] = { delta: ins.delta, confident: ins.confident, tier: ins.tier }
    }

    for (const id of pinned) {
      const ins = byId.get(id)
      if (!ins) continue // not enough data this window
      const cur = { delta: ins.delta, confident: ins.confident, tier: ins.tier }
      const prev = prevState[id]
      nextState[id] = cur

      if (!prev) continue // first observation — set baseline, don't alert
      if (graduated.some(g => g.id === id)) continue // already announced above

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
      ? `${first.reason === "is now a solid pattern" ? "New solid pattern" : "A pattern you're watching " + first.reason}: ${first.finding}`
      : `${changes.length} patterns changed — tap to see.`

    // ── Push ──
    const userSubs = subsByUser.get(userId)
    if (userSubs && await sendToUser(userSubs, {
      title: "Pattern update 📊",
      body,
      url: "/dashboard/insights",
      tag: "correlation-watch",
      requireInteraction: false,
    })) {
      pushed++
    }

    // ── Email ──
    const u = userById.get(userId)
    if (resend && u?.email) {
      try {
        await resend.emails.send({
          from: "Emergenthealth <onboarding@resend.dev>",
          to: u.email,
          subject: `📊 ${changes.length} pattern${changes.length === 1 ? "" : "s"} changed`,
          html: buildEmail(u.name, changes, appUrl),
        })
        emailed++
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({ ok: true, checked, pushed, emailed, users: userIds.length })
}
