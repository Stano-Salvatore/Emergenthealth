import { NextRequest, NextResponse } from "next/server"
import webpush from "web-push"
import { prisma } from "@/lib/prisma"
import { getUserTimezone, localDateStr, localTimeStr } from "@/lib/local-date"
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

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    return NextResponse.json({ ok: true, skipped: "push not configured" })
  }
  webpush.setVapidDetails(process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app", publicKey, privateKey)

  const schedules = await prisma.medSchedule.findMany({
    where: { active: true, remind: true },
    select: {
      id: true, userId: true, name: true, dose: true, times: true,
      daysOfWeek: true, active: true, startDate: true, endDate: true,
    },
  })
  if (schedules.length === 0) return NextResponse.json({ ok: true, checked: 0, pushed: 0 })

  const userIds = [...new Set(schedules.map(s => s.userId))]

  type SubRow = { userId: string; endpoint: string; p256dh: string; auth: string }
  const subs = await prisma.$queryRaw<SubRow[]>`
    SELECT DISTINCT ON ("userId") "userId", endpoint, p256dh, auth
    FROM "PushSubscription"
    WHERE "userId" = ANY(${userIds}::text[])
    ORDER BY "userId", "createdAt" DESC
  `.catch(() => [] as SubRow[])
  const subByUser = new Map(subs.map(s => [s.userId, s]))
  if (subByUser.size === 0) return NextResponse.json({ ok: true, checked: 0, pushed: 0 })

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
    const sub = subByUser.get(userId)
    if (!sub) continue
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

    const listed = due.slice(0, MAX_LISTED).join(", ")
    const body = due.length > MAX_LISTED ? `${listed} +${due.length - MAX_LISTED} more` : listed

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          title: "💊 Time for your dose",
          body,
          url: "/dashboard/medications",
          tag: "med-reminder",
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

  return NextResponse.json({ ok: true, checked, pushed })
}
