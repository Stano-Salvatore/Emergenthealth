import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { addDaysISO, localDateStr, localTimeStr } from "@/lib/local-date"
import { readSentLog, writeSentLog } from "@/lib/sent-log"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Wind-down nudge on heavy days. Oura syncs every 30 minutes, so by evening
// the day's stress minutes are real data, not a guess. When today was
// measurably harder than usual — elevated stress well above the personal
// baseline, or a short night followed by low readiness — one push at
// 20:00–21:59 local suggests an earlier night, with the actual numbers in it.
//
// Deliberately hard to trigger: the rules are fixed (no "AI decides you
// should relax"), it never fires two days in a row, and a preference turns
// it off entirely. A nudge that fires often stops being one.

const SENT_KEY = "daily_nudges_sent"
const SENT_ID = "wind-down"
const LAST_SENT_KEY = "wind_down_last_sent" // sent log resets daily; two-day cap needs its own memory

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  if (!configurePush()) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 503 })
  }

  const byUser = await loadSubscriptionsByUser()
  if (byUser.size === 0) return NextResponse.json({ ok: true, sent: 0 })

  const userIds = [...byUser.keys()]
  const prefRows = await prisma.userPreference.findMany({
    where: { userId: { in: userIds }, key: { in: ["timezone", "wind_down_enabled", LAST_SENT_KEY] } },
    select: { userId: true, key: true, value: true },
  }).catch(() => [] as { userId: string; key: string; value: string }[])
  const prefs = new Map<string, Record<string, string>>()
  for (const r of prefRows) {
    const m = prefs.get(r.userId) ?? {}
    m[r.key] = r.value
    prefs.set(r.userId, m)
  }

  let sent = 0

  for (const [userId, subs] of byUser) {
    if (prefs.get(userId)?.["wind_down_enabled"] === "false") continue

    const timezone = prefs.get(userId)?.["timezone"]?.trim() || "UTC"
    const localHour = parseInt(localTimeStr(timezone).slice(0, 2), 10)
    if (localHour !== 20 && localHour !== 21) continue

    const localDate = localDateStr(timezone)

    const alreadySent = await readSentLog(userId, SENT_KEY, localDate)
    if (alreadySent.has(SENT_ID)) continue

    // Never two evenings in a row — yesterday's nudge is this evening's veto.
    if (prefs.get(userId)?.[LAST_SENT_KEY] === addDaysISO(localDate, -1)) continue

    const since = new Date(addDaysISO(localDate, -30) + "T00:00:00Z")
    const logs = await prisma.healthLog.findMany({
      where: { userId, date: { gte: since } },
      orderBy: { date: "asc" },
      select: { date: true, stressHigh: true, sleepDuration: true, readinessScore: true },
    }).catch(() => [] as { date: Date; stressHigh: number | null; sleepDuration: number | null; readinessScore: number | null }[])

    const todayLog = logs.find(l => l.date.toISOString().slice(0, 10) === localDate)
    if (!todayLog) continue

    const baselineVals = logs
      .filter(l => l.date.toISOString().slice(0, 10) !== localDate && l.stressHigh != null)
      .map(l => l.stressHigh!)
    const baseline = baselineVals.length >= 5
      ? baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length
      : null

    const stress = todayLog.stressHigh
    const sleepMin = todayLog.sleepDuration
    const readiness = todayLog.readinessScore

    // A: today's stress is high in absolute terms AND clearly above the
    //    personal baseline (or very high when no baseline exists yet).
    const heavyStress = stress != null
      && stress >= 90
      && (baseline != null ? stress >= baseline * 1.3 : stress >= 120)
    // B: short night into a low-readiness day — the debt is already visible.
    const roughStart = sleepMin != null && sleepMin < 360
      && readiness != null && readiness < 70

    if (!heavyStress && !roughStart) continue

    const stressH = stress != null ? (stress / 60).toFixed(1) : null
    const body = heavyStress
      ? `Heavy day — ${stressH}h of elevated stress${baseline != null ? ` vs your usual ${(baseline / 60).toFixed(1)}h` : ""}. Tonight's a good night to wind down early.`
      : `Short night (${(sleepMin! / 60).toFixed(1)}h) and readiness at ${readiness} today — an earlier night would repay some of that.`

    const delivered = await sendToUser(subs, {
      title: "Emergy 🌱",
      body,
      url: "/dashboard",
      tag: "wind-down",
      requireInteraction: false,
    })
    if (delivered) sent++

    alreadySent.add(SENT_ID)
    await writeSentLog(userId, SENT_KEY, localDate, alreadySent)
    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: LAST_SENT_KEY } },
      create: { userId, key: LAST_SENT_KEY, value: localDate },
      update: { value: localDate },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, sent, total: byUser.size })
}
