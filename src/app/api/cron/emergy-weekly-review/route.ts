import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { Resend } from "resend"
import { prisma } from "@/lib/prisma"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { localDateStr, localTimeStr } from "@/lib/local-date"
import { readSentLog, writeSentLog } from "@/lib/sent-log"
import { generateWeeklyReview, saveWeeklyReview, type WeeklyReview } from "@/lib/weekly-review"
import { isReviewWindow, parseSchedule } from "@/lib/weekly-review-schedule"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60 // full-context Opus generation runs tens of seconds

// Weekly review, written by Emergy with the full chat brain —
// goals, patterns, wearable gaps and all. Replaces the old Sunday-morning
// digest email, whose narrative was two generic Haiku sentences over bare
// averages. Ticked every ten minutes by the Actions reminders cron; the
// per-day sent log makes the extra ticks harmless, and the review lands on the
// day and hour chosen in Settings — in the user's own timezone, not a fixed UTC
// hour. Sunday evening if they never chose. Stored for the dashboard card,
// pushed, and emailed.

const SENT_KEY = "daily_nudges_sent"
const SENT_ID = "weekly-review"

// The Settings "email digest" section toggles used to drive the retired
// weekly-digest email; the review email's stat tiles honor them now, so the
// UI still controls what it says it controls. minDays gates the tiles the
// same way it used to gate the digest's averages.
type DigestPrefs = { sections: Record<string, boolean>; minDays: number }

function parseDigestPrefs(value: string | undefined): DigestPrefs {
  try {
    const parsed = value ? JSON.parse(value) : {}
    return {
      sections: parsed.sections ?? {},
      minDays: Number(parsed.thresholds?.minDays) || 3,
    }
  } catch {
    return { sections: {}, minDays: 3 }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ))
}

function reviewEmail(name: string, review: WeeklyReview, appUrl: string, prefs: DigestPrefs): string {
  const { stats } = review
  const on = (key: string) => prefs.sections[key] !== false // unset = on
  const enoughDays = stats.daysTracked >= prefs.minDays
  const paragraphs = review.narrative
    .split(/\n\s*\n/)
    .map(p => `<p style="margin:0 0 12px;font-size:14px;line-height:1.65;color:#e0e0f0;">${escapeHtml(p.trim())}</p>`)
    .join("")

  const tile = (label: string, value: string, prev: string | null, color: string) => `
    <div style="background:#1a192a;border-radius:12px;padding:14px 18px;flex:1;min-width:130px;">
      <div style="font-size:11px;color:#7a7a96;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">${label}</div>
      <div style="font-size:22px;font-weight:700;color:${color};">${value}</div>
      ${prev ? `<div style="font-size:11px;color:#7a7a96;margin-top:4px;">last week ${prev}</div>` : ""}
    </div>`

  const tiles = (enoughDays ? [
    on("sleep") && stats.avgSleepH != null ? tile("Avg sleep", `${stats.avgSleepH}h`, stats.prevAvgSleepH != null ? `${stats.prevAvgSleepH}h` : null, "#818cf8") : "",
    on("hrv") && stats.avgHrv != null ? tile("Avg HRV", `${stats.avgHrv}ms`, stats.prevAvgHrv != null ? `${stats.prevAvgHrv}ms` : null, "#34d399") : "",
    on("steps") && stats.totalSteps > 0 ? tile("Steps", stats.totalSteps.toLocaleString(), null, "#fbbf24") : "",
    on("habits") && stats.habitRate != null ? tile("Habits", `${stats.habitRate}%`, null, "#a78bfa") : "",
  ] : []).filter(Boolean).join("")

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#09090f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f2f2fa;">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
    <div style="background:linear-gradient(135deg,#312e81,#4f46e5);border-radius:16px;padding:28px 24px;margin-bottom:24px;text-align:center;">
      <div style="font-size:13px;color:#a5b4fc;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">🌱 Your week, by Emergy</div>
      <div style="font-size:24px;font-weight:800;color:#ffffff;">Hey ${escapeHtml(name)}</div>
      <div style="font-size:14px;color:#c7d2fe;margin-top:6px;">Week of ${escapeHtml(review.weekOf)}</div>
    </div>
    <div style="background:#13122b;border:1px solid #312e81;border-radius:12px;padding:20px;margin-bottom:20px;">
      ${paragraphs}
    </div>
    ${tiles ? `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">${tiles}</div>` : ""}
    <div style="text-align:center;">
      <a href="${appUrl}/dashboard/week" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;">Open your week →</a>
    </div>
    <div style="text-align:center;margin-top:32px;padding-top:20px;border-top:1px solid #201f32;">
      <div style="font-size:12px;color:#7a7a96;">Emergenthealth • Your personal health dashboard</div>
    </div>
  </div>
</body>
</html>`
}

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true },
  }).catch(() => [] as { id: string; name: string | null; email: string | null }[])
  if (users.length === 0) return NextResponse.json({ ok: true, generated: 0 })

  const prefRows = await prisma.userPreference.findMany({
    where: {
      userId: { in: users.map(u => u.id) },
      key: { in: ["timezone", "digest_prefs", "weekly_review_time"] },
    },
    select: { userId: true, key: true, value: true },
  }).catch(() => [] as { userId: string; key: string; value: string }[])
  const tzByUser = new Map(prefRows.filter(r => r.key === "timezone").map(r => [r.userId, r.value.trim() || "UTC"]))
  const scheduleByUser = new Map(users.map(u => [
    u.id,
    parseSchedule(prefRows.find(r => r.userId === u.id && r.key === "weekly_review_time")?.value),
  ]))
  const prefsByUser = new Map(users.map(u => [
    u.id,
    parseDigestPrefs(prefRows.find(r => r.userId === u.id && r.key === "digest_prefs")?.value),
  ]))

  const pushReady = configurePush()
  const subsByUser = pushReady ? await loadSubscriptionsByUser() : new Map()
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? "https://emergenthealth.vercel.app"

  let generated = 0
  let pushed = 0
  let emailed = 0

  for (const user of users) {
    const timezone = tzByUser.get(user.id) ?? "UTC"
    const localDate = localDateStr(timezone)
    const localHour = parseInt(localTimeStr(timezone).slice(0, 2), 10)

    // Their chosen day and hour, local, with the sent log absorbing the extra
    // ticks inside the two-hour window.
    const dow = new Date(localDate + "T12:00:00Z").getUTCDay()
    if (!isReviewWindow(scheduleByUser.get(user.id)!, dow, localHour)) continue

    const alreadySent = await readSentLog(user.id, SENT_KEY, localDate)
    if (alreadySent.has(SENT_ID)) continue

    let review: WeeklyReview | null
    try {
      review = await generateWeeklyReview(user.id, timezone)
    } catch {
      continue // transient failure — the next tick inside the window retries
    }

    // Record before delivering: a user with an empty week shouldn't be
    // re-evaluated (and possibly re-billed) on every remaining tick.
    alreadySent.add(SENT_ID)
    await writeSentLog(user.id, SENT_KEY, localDate, alreadySent)
    if (!review) continue

    await saveWeeklyReview(user.id, review)
    generated++

    const subs = subsByUser.get(user.id)
    if (subs && await sendToUser(subs, {
      title: "🌱 Your week, by Emergy",
      body: "Your weekly review is ready — how the week actually went, and one thing for next week.",
      url: "/dashboard/week",
      tag: "weekly-review",
      requireInteraction: false,
    })) {
      pushed++
    }

    if (resend && user.email) {
      try {
        await resend.emails.send({
          from: "Emergenthealth <onboarding@resend.dev>",
          to: user.email,
          subject: `🌱 Your week, by Emergy — week of ${review.weekOf}`,
          html: reviewEmail(user.name?.split(" ")[0] ?? "there", review, appUrl, prefsByUser.get(user.id) ?? parseDigestPrefs(undefined)),
        })
        emailed++
      } catch { /* non-fatal */ }
    }

    // One generation per tick: a full-context Opus call runs tens of seconds,
    // and two in one invocation risks the function budget killing the second
    // mid-flight. The 10-minute tick serves the next user inside the window.
    break
  }

  return NextResponse.json({ ok: true, generated, pushed, emailed, users: users.length })
}
