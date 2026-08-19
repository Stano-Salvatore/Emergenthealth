import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { localDateStr, localTimeStr } from "@/lib/local-date"
import { readSentLog, writeSentLog } from "@/lib/sent-log"
import { buildSchedule, type ExperimentRow } from "@/lib/experiments"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// An experiment lives or dies on adherence, and adherence dies quietly: the
// user forgets which arm they're in, guesses, and the two groups blur into
// each other until the answer means nothing. One morning push per running
// experiment says which day it is and what that means today.
//
// Ticked every ten minutes by the Actions cron; window-gated to the user's own
// morning and recorded in the shared per-day sent log, so the extra ticks
// deliver nothing.

const SENT_KEY = "daily_nudges_sent"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!configurePush()) {
    return NextResponse.json({ error: "VAPID keys not configured" }, { status: 503 })
  }

  const running = await prisma.experiment.findMany({
    where: { status: "running" },
    include: { days: { select: { date: true } } },
  }).catch(() => [])
  if (running.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  const userIds = [...new Set(running.map(e => e.userId))]
  const subsByUser = await loadSubscriptionsByUser(userIds)
  if (subsByUser.size === 0) return NextResponse.json({ ok: true, sent: 0 })

  const tzRows = await prisma.userPreference.findMany({
    where: { userId: { in: userIds }, key: "timezone" },
    select: { userId: true, value: true },
  }).catch(() => [] as { userId: string; value: string }[])
  const tzByUser = new Map(tzRows.map(r => [r.userId, r.value.trim() || "UTC"]))

  let sent = 0

  for (const e of running) {
    const subs = subsByUser.get(e.userId)
    if (!subs) continue

    const tz = tzByUser.get(e.userId) ?? "UTC"
    const localHour = parseInt(localTimeStr(tz).slice(0, 2), 10)
    if (localHour < 8 || localHour > 9) continue

    const localDate = localDateStr(tz)
    const sentId = `experiment:${e.id}`
    const alreadySent = await readSentLog(e.userId, SENT_KEY, localDate)
    if (alreadySent.has(sentId)) continue

    const schedule = buildSchedule(e as ExperimentRow)
    const idx = schedule.findIndex(d => d.date === localDate)
    if (idx === -1) continue // hasn't started, or already over

    const day = schedule[idx]
    const yesterday = idx > 0 ? schedule[idx - 1] : null
    const switched = yesterday != null && yesterday.on !== day.on
    // Already answered today (logged early) — no need to poke.
    if (e.days.some(d => d.date === localDate)) continue

    const title = switched
      ? (day.on ? "🧪 Switching on today" : "🧪 Switching off today")
      : (day.on ? "🧪 On day" : "🧪 Off day")
    const body = day.on
      ? `${e.name} — day ${idx + 1} of ${schedule.length}. Today: ${e.action}`
      : `${e.name} — day ${idx + 1} of ${schedule.length}. Today is a control day: skip it.`

    const delivered = await sendToUser(subs, {
      title,
      body,
      url: "/dashboard/experiments",
      tag: `experiment-${e.id}`,
      requireInteraction: false,
    })
    if (delivered) sent++

    alreadySent.add(sentId)
    await writeSentLog(e.userId, SENT_KEY, localDate, alreadySent)
  }

  return NextResponse.json({ ok: true, sent, running: running.length })
}
