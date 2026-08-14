import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { localCoversNow, parseCoverage } from "@/lib/local-notifications"
import { readSentLog, writeSentLog } from "@/lib/sent-log"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { localDateStr, localTimeStr } from "@/lib/local-date"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// How far back a reminder may be and still be worth sending. This job used to
// require the clock to match a reminder's time to the exact minute, so unless a
// run happened to land on that minute nothing was ever delivered. Now anything
// due within this window fires on the next run — which also survives the
// scheduler being a few minutes late — while a window (rather than "anything
// earlier today") stops the whole day's backlog arriving at once.
const CATCHUP_MINUTES = 150

function minutesBefore(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number)
  const total = Math.max(0, (h ?? 0) * 60 + (m ?? 0) - minutes)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

// The per-user, per-day sent record lives in @/lib/sent-log under this key.
const SENT_KEY = "reminders_sent"

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!configurePush()) {
    return NextResponse.json({ error: "VAPID not configured" }, { status: 503 })
  }

  const byUser = await loadSubscriptionsByUser()
  if (byUser.size === 0) return NextResponse.json({ ok: true, sent: 0 })

  // Which users' phones have already scheduled these locally. Those get no
  // habit or reminder push — the device will fire at the exact time, and two
  // notifications for one habit is worse than either alone. Streak protection
  // below is unaffected: it depends on server-side streak maths the phone has
  // no way to schedule for itself.
  const coverageRows = await prisma.$queryRaw<{ userId: string; value: string }[]>`
    SELECT "userId", "value" FROM "UserPreference" WHERE "key" = 'local_notifications_synced'
  `.catch(() => [] as { userId: string; value: string }[])
  const coverageByUser = new Map(coverageRows.map(r => [r.userId, parseCoverage(r.value)]))

  // Timezones for everyone in one query rather than one per user per tick.
  const tzRows = await prisma.$queryRaw<{ userId: string; value: string }[]>`
    SELECT "userId", "value" FROM "UserPreference" WHERE "key" = 'timezone'
  `.catch(() => [] as { userId: string; value: string }[])
  const tzByUser = new Map(tzRows.map(r => [r.userId, r.value]))

  let totalSent = 0

  for (const [userId, subs] of byUser) {
    const phoneCovers = localCoversNow(coverageByUser.get(userId) ?? { syncedAt: null, windowDays: null })

    const timezone = tzByUser.get(userId)?.trim() || "UTC"

    const localTime = localTimeStr(timezone)
    const localDate = localDateStr(timezone)
    const windowStart = minutesBefore(localTime, CATCHUP_MINUTES)

    const alreadySent = await readSentLog(userId, SENT_KEY, localDate)

    // Incomplete habits whose reminder fell due in the catch-up window
    const habitReminders = phoneCovers ? [] : (await prisma.$queryRaw<{ id: string; name: string; reminderTime: string }[]>`
      SELECT h.id, h.name, h."reminderTime"
      FROM "Habit" h
      WHERE h."userId" = ${userId}
        AND h."isArchived" = false
        AND h."reminderTime" IS NOT NULL
        AND h."reminderTime" <= ${localTime}
        AND h."reminderTime" >= ${windowStart}
        AND NOT EXISTS (
          SELECT 1 FROM "HabitCompletion" hc
          WHERE hc."habitId" = h.id AND hc."date"::date = ${localDate}::date
        )
    `.catch(() => [] as { id: string; name: string; reminderTime: string }[]))
      .filter(h => !alreadySent.has(`habit:${h.id}`))

    // Reminders due today or overdue, same window, not yet ticked off
    const reminderAlerts = phoneCovers ? [] : (await prisma.$queryRaw<{ id: string; title: string; reminderTime: string }[]>`
      SELECT id, title, "reminderTime"
      FROM "Reminder"
      WHERE "userId" = ${userId}
        AND "isCompleted" = false
        AND "reminderTime" IS NOT NULL
        AND "reminderTime" <= ${localTime}
        AND "reminderTime" >= ${windowStart}
        AND "dueDate"::date <= ${localDate}::date
    `.catch(() => [] as { id: string; title: string; reminderTime: string }[]))
      .filter(r => !alreadySent.has(`reminder:${r.id}`))

    // Streak protection: from 21:00 local, warn about habits with streaks at risk
    let streakProtectionNotif: { title: string; body: string; url: string; tag: string; requireInteraction: boolean } | null = null
    if (localTime >= "21:00" && localTime < "23:30" && !alreadySent.has("streak")) {
      // The recent-completions threshold lives in WHERE, not HAVING: HAVING
      // without GROUP BY makes this an aggregate query, at which point
      // selecting bare h.id is invalid PostgreSQL — the query errored on
      // every run and the catch below quietly turned that into "no habits at
      // risk", so this warning never fired for anyone.
      const atRiskHabits = await prisma.$queryRaw<{ id: string; name: string }[]>`
        SELECT h.id, h.name
        FROM "Habit" h
        WHERE h."userId" = ${userId}
          AND h."isArchived" = false
          AND NOT EXISTS (
            SELECT 1 FROM "HabitCompletion" hc
            WHERE hc."habitId" = h.id AND hc."date"::date = ${localDate}::date
          )
          AND (SELECT COUNT(*) FROM "HabitCompletion" hc2
               WHERE hc2."habitId" = h.id
                 AND hc2."date"::date >= (CURRENT_DATE - INTERVAL '30 days')
                 AND hc2."date"::date < CURRENT_DATE) > 2
        LIMIT 3
      `.catch(() => [] as { id: string; name: string }[])

      if (atRiskHabits.length > 0) {
        streakProtectionNotif = {
          title: "🔥 Streak at risk!",
          body: atRiskHabits.length === 1
            ? `Complete "${atRiskHabits[0].name}" before midnight!`
            : `${atRiskHabits.map(h => h.name).join(", ")} still need completing tonight`,
          url: "/dashboard/habits",
          tag: "streak-protection",
          requireInteraction: true,
        }
      }
    }

    if (habitReminders.length === 0 && reminderAlerts.length === 0 && !streakProtectionNotif) continue

    const notifications: { title: string; body: string; url: string; tag: string; requireInteraction?: boolean }[] = []

    if (streakProtectionNotif) notifications.push(streakProtectionNotif)

    for (const h of habitReminders) {
      notifications.push({
        title: `Habit reminder 🔔`,
        body: `Don't forget: ${h.name}`,
        url: "/dashboard/habits",
        tag: `habit-${h.id}`,
      })
    }

    for (const r of reminderAlerts) {
      notifications.push({
        title: `Reminder 🔔`,
        body: r.title,
        url: "/dashboard/reminders",
        tag: `reminder-${r.id}`,
      })
    }

    for (const notif of notifications) {
      const delivered = await sendToUser(subs, notif)
      if (delivered) totalSent++
    }

    // Mark everything from this pass as delivered. Recorded even if every push
    // failed: a dead subscription would otherwise retry on every run all day.
    if (streakProtectionNotif) alreadySent.add("streak")
    for (const h of habitReminders)  alreadySent.add(`habit:${h.id}`)
    for (const r of reminderAlerts)  alreadySent.add(`reminder:${r.id}`)
    await writeSentLog(userId, SENT_KEY, localDate, alreadySent)
  }

  return NextResponse.json({ ok: true, sent: totalSent })
}
