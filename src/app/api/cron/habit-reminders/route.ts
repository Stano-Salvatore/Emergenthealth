import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { prisma } from "@/lib/prisma"
import { localCoversNow, parseCoverage } from "@/lib/local-notifications"
import { readSentLog, writeSentLog } from "@/lib/sent-log"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { addDaysISO, localDateStr, localTimeStr } from "@/lib/local-date"
import { isScheduledOn, streakAtRiskTonight } from "@/lib/habit-schedule"
import { getVacationWindow, makeIsFrozen } from "@/lib/streak"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// How far back a reminder may be and still be worth sending. This job used to
// require the clock to match a reminder's time to the exact minute, so unless a
// run happened to land on that minute nothing was ever delivered. Now anything
// due within this window fires on the next run — which also survives the
// scheduler being a few minutes late — while a window (rather than "anything
// earlier today") stops the whole day's backlog arriving at once.
//
// Sized to the scheduler as it behaves, not as it is configured: the
// "every 10 minutes" GitHub workflow has been seen running 2–5 hours apart,
// and a reminder that falls due inside a gap wider than this is never sent.
// Late beats never.
const CATCHUP_MINUTES = 330

// Enough history for the streak check to see a run worth warning about.
const STREAK_LOOKBACK_DAYS = 60

function minutesBefore(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number)
  const total = Math.max(0, (h ?? 0) * 60 + (m ?? 0) - minutes)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

// The per-user, per-day sent record lives in @/lib/sent-log under this key.
const SENT_KEY = "reminders_sent"

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

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
    const habitReminders = phoneCovers ? [] : (await prisma.$queryRaw<{ id: string; name: string; reminderTime: string; scheduleDays: number[]; timesPerWeek: number | null }[]>`
      SELECT h.id, h.name, h."reminderTime", h."scheduleDays", h."timesPerWeek"
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
        AND NOT EXISTS (
          SELECT 1 FROM "HabitSkip" hs
          WHERE hs."habitId" = h.id AND hs."date"::date = ${localDate}::date
        )
    `.catch(() => [] as { id: string; name: string; reminderTime: string; scheduleDays: number[]; timesPerWeek: number | null }[]))
      // An off-day is not a missed day: a Mon/Wed/Fri habit stays quiet on Tuesday.
      .filter(h => isScheduledOn({ scheduleDays: h.scheduleDays ?? [], timesPerWeek: h.timesPerWeek ?? null }, localDate))
      .filter(h => !alreadySent.has(`habit:${h.id}:${h.reminderTime}`))

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
      .filter(r => !alreadySent.has(`reminder:${r.id}:${r.reminderTime}`))

    // Streak protection: from 21:00 local, warn about habits with streaks at risk
    let streakProtectionNotif: { title: string; body: string; url: string; tag: string; requireInteraction: boolean } | null = null
    if (localTime >= "21:00" && localTime < "23:30" && !alreadySent.has("streak")) {
      // The same streak the Habits page shows, not a count of recent
      // completions: that called a habit last done three weeks ago "at risk"
      // every night, and a weekly habit whose week was already won too.
      const since = new Date(addDaysISO(localDate, -STREAK_LOOKBACK_DAYS) + "T00:00:00Z")
      const [habits, vacation] = await Promise.all([
        prisma.habit.findMany({
          where: { userId, isArchived: false },
          orderBy: { createdAt: "asc" },
          select: {
            id: true, name: true, scheduleDays: true, timesPerWeek: true,
            completions: { where: { date: { gte: since } }, select: { date: true } },
            skips: { where: { date: { gte: since } }, select: { date: true } },
          },
        }).catch(() => []),
        getVacationWindow(userId),
      ])
      const isFrozen = makeIsFrozen(vacation)
      // Date-only columns: the ISO date is the day each row was filed under.
      const day = (d: Date) => d.toISOString().slice(0, 10)
      const atRiskHabits = habits.filter(h => streakAtRiskTonight(
        { scheduleDays: h.scheduleDays ?? [], timesPerWeek: h.timesPerWeek ?? null },
        new Set(h.completions.map(c => day(c.date))),
        new Set(h.skips.map(s => day(s.date))),
        localDate,
        isFrozen,
      )).slice(0, 3)

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
    // The time is part of the key, so one snoozed or re-timed after it pushed
    // is sent again at its new time rather than counted as already sent.
    if (streakProtectionNotif) alreadySent.add("streak")
    for (const h of habitReminders)  alreadySent.add(`habit:${h.id}:${h.reminderTime}`)
    for (const r of reminderAlerts)  alreadySent.add(`reminder:${r.id}:${r.reminderTime}`)
    await writeSentLog(userId, SENT_KEY, localDate, alreadySent)
  }

  return NextResponse.json({ ok: true, sent: totalSent })
}
