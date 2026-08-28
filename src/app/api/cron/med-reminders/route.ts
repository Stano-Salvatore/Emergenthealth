import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { configurePush, loadLocalCoverage, loadSubscriptionsByUser, phoneCovers, sendToUser } from "@/lib/push"
import { localDateStr, localTimeStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { activeOn, matchKey, minutesOfDay, sortedTimes, type ScheduleLike } from "@/lib/med-schedule"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Hourly. A scheduled time that has come round within the last hour and has no
// matching dose logged gets one notification — one, ever, for that time on that
// day. The reminder deep-links to the medications page, where tapping "took it"
// writes a real dose, so acknowledging the reminder and recording the dose are
// the same action rather than two things to remember.
//
// Every time is judged in the user's own timezone, not the server's: a 21:00
// dose in Bratislava is 19:00 UTC, and reminding someone at the wrong hour is
// worse than not reminding them at all.

const LOOKBACK_MIN = 60
const MAX_LISTED = 3

type Sent = Record<string, string> // "scheduleId|HH:mm" → YYYY-MM-DD it was sent for

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  if (!configurePush()) {
    return NextResponse.json({ ok: true, skipped: "push not configured" })
  }

  const schedules = await prisma.medSchedule.findMany({
    where: { active: true, remind: true },
    select: {
      id: true, userId: true, name: true, dose: true, times: true,
      daysOfWeek: true, active: true, startDate: true, endDate: true,
    },
  })
  if (schedules.length === 0) return NextResponse.json({ ok: true, checked: 0, pushed: 0 })

  const userIds = [...new Set(schedules.map(s => s.userId))]

  const subsByUser = await loadSubscriptionsByUser(userIds)
  const coverage = await loadLocalCoverage()
  if (subsByUser.size === 0) return NextResponse.json({ ok: true, checked: 0, pushed: 0 })

  const stateRows = await prisma.$queryRaw<{ userId: string; value: string }[]>`
    SELECT "userId","value" FROM "UserPreference" WHERE "key" = 'med_reminder_state'
  `.catch(() => [] as { userId: string; value: string }[])
  const stateByUser = new Map<string, Sent>()
  for (const r of stateRows) {
    try { stateByUser.set(r.userId, JSON.parse(r.value)) } catch { /* skip malformed */ }
  }

  let checked = 0
  let pushed = 0

  for (const userId of userIds) {
    const subs = subsByUser.get(userId)
    if (!subs) continue
    checked++

    const tz = await getUserTimezone(userId)
    const today = localDateStr(tz)
    const nowMinutes = minutesOfDay(localTimeStr(tz))

    const mine = schedules.filter(s => s.userId === userId)

    const doseRows = await prisma.$queryRaw<{ tagName: string | null; text: string | null }[]>`
      SELECT "tagName","text" FROM "OuraTag" WHERE "userId" = ${userId} AND "day" = ${today}
    `.catch(() => [] as { tagName: string | null; text: string | null }[])
    const takenByKey = new Map<string, number>()
    for (const r of doseRows) {
      const name = (r.tagName ?? r.text ?? "").trim()
      if (!name) continue
      const k = matchKey(name)
      takenByKey.set(k, (takenByKey.get(k) ?? 0) + 1)
    }

    const prev = stateByUser.get(userId) ?? {}
    // Only today's marks are worth carrying — yesterday's can't suppress
    // anything, and left in place the blob would grow without limit.
    const next: Sent = Object.fromEntries(Object.entries(prev).filter(([, day]) => day === today))

    const due: string[] = []
    for (const s of mine) {
      const shape: ScheduleLike = {
        id: s.id, name: s.name, times: s.times, daysOfWeek: s.daysOfWeek,
        active: s.active, startDate: s.startDate, endDate: s.endDate,
      }
      if (!activeOn(shape, today)) continue

      const taken = takenByKey.get(matchKey(s.name)) ?? 0
      const times = sortedTimes(shape)
      times.forEach((time, i) => {
        // Doses are covered in order, so the i-th time is satisfied once i+1
        // doses exist — the same rule the page shows.
        if (i < taken) return
        const at = minutesOfDay(time)
        if (at > nowMinutes || at <= nowMinutes - LOOKBACK_MIN) return
        const key = `${s.id}|${time}`
        if (next[key] === today) return
        next[key] = today
        due.push(s.dose ? `${s.name} (${s.dose})` : s.name)
      })
    }

    const stateJson = JSON.stringify(next)
    await prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId","key","value") VALUES (${userId},'med_reminder_state',${stateJson})
      ON CONFLICT ("userId","key") DO UPDATE SET "value"=${stateJson}
    `.catch(() => {})

    if (due.length === 0) continue

    // The phone laid these down locally at the exact times, so the push would
    // be a second buzz for the same dose. Gated here rather than at the top of
    // the loop on purpose: the state above still advances, so nothing floods
    // out in one burst the moment the local window lapses.
    if (phoneCovers(coverage, userId)) continue

    const listed = due.slice(0, MAX_LISTED).join(", ")
    const body = due.length > MAX_LISTED ? `${listed} +${due.length - MAX_LISTED} more` : listed

    const delivered = await sendToUser(subs, {
      title: "💊 Time for your dose",
      body,
      url: "/dashboard/medications",
      tag: "med-reminder",
      requireInteraction: false,
    })
    if (delivered) pushed++
  }

  return NextResponse.json({ ok: true, checked, pushed })
}
