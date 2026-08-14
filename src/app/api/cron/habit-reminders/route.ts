import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { localCoversNow, parseCoverage } from "@/lib/local-notifications"
import webpush from "web-push"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getCurrentHHMM(timezone: string): string {
  try {
    const now = new Date()
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now)
    const h = parts.find(p => p.type === "hour")?.value ?? "00"
    const m = parts.find(p => p.type === "minute")?.value ?? "00"
    return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`
  } catch {
    return new Date().toISOString().slice(11, 16)
  }
}

function getLocalDateStr(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date())
  } catch {
    return new Date().toISOString().split("T")[0]
  }
}

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

// Per-user, per-day record of what has already gone out, so a job that runs
// every few minutes doesn't re-send the same reminder on every pass.
interface SentLog { date: string; ids: string[] }

async function readSentLog(userId: string, localDate: string): Promise<Set<string>> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "reminders_sent" } },
    select: { value: true },
  }).catch(() => null)
  try {
    const parsed = JSON.parse(row?.value ?? "{}") as SentLog
    if (parsed.date === localDate && Array.isArray(parsed.ids)) return new Set(parsed.ids)
  } catch { /* corrupt or first run — start clean */ }
  return new Set()
}

async function writeSentLog(userId: string, localDate: string, ids: Set<string>): Promise<void> {
  const value = JSON.stringify({ date: localDate, ids: [...ids] } satisfies SentLog)
  await prisma.userPreference.upsert({
    where:  { userId_key: { userId, key: "reminders_sent" } },
    create: { userId, key: "reminders_sent", value },
    update: { value },
  }).catch(() => {})
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = process.env.VAPID_EMAIL ?? "mailto:admin@emergenthealth.app"
  if (!publicKey || !privateKey) {
    return NextResponse.json({ error: "VAPID not configured" }, { status: 503 })
  }
  webpush.setVapidDetails(email, publicKey, privateKey)

  // Get all users with push subscriptions
  const subscribers = await prisma.$queryRaw<{ userId: string; endpoint: string; p256dh: string; auth: string }[]>`
    SELECT "userId", "endpoint", "p256dh", "auth" FROM "PushSubscription"
  `.catch(() => [] as { userId: string; endpoint: string; p256dh: string; auth: string }[])

  if (subscribers.length === 0) return NextResponse.json({ ok: true, sent: 0 })

  // Group subscriptions by userId
  const byUser = new Map<string, { endpoint: string; p256dh: string; auth: string }[]>()
  for (const s of subscribers) {
    if (!byUser.has(s.userId)) byUser.set(s.userId, [])
    byUser.get(s.userId)!.push({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })
  }

  // Which users' phones have already scheduled these locally. Those get no
  // habit or reminder push — the device will fire at the exact time, and two
  // notifications for one habit is worse than either alone. Streak protection
  // below is unaffected: it depends on server-side streak maths the phone has
  // no way to schedule for itself.
  const coverageRows = await prisma.$queryRaw<{ userId: string; value: string }[]>`
    SELECT "userId", "value" FROM "UserPreference" WHERE "key" = 'local_notifications_synced'
  `.catch(() => [] as { userId: string; value: string }[])
  const coverageByUser = new Map(coverageRows.map(r => [r.userId, parseCoverage(r.value)]))

  let totalSent = 0

  for (const [userId, subs] of byUser) {
    const phoneCovers = localCoversNow(coverageByUser.get(userId) ?? { syncedAt: null, windowDays: null })

    // Get user timezone
    const tzRows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM "UserPreference" WHERE "userId" = ${userId} AND key = 'timezone' LIMIT 1
    `.catch(() => [] as { value: string }[])
    const timezone = tzRows[0]?.value ?? "UTC"

    const localTime = getCurrentHHMM(timezone)
    const localDate = getLocalDateStr(timezone)
    const windowStart = minutesBefore(localTime, CATCHUP_MINUTES)

    const alreadySent = await readSentLog(userId, localDate)

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
      const atRiskHabits = await prisma.$queryRaw<{ id: string; name: string; streak: number }[]>`
        SELECT h.id, h.name,
          (SELECT COUNT(*) FROM "HabitCompletion" hc2
           WHERE hc2."habitId" = h.id
             AND hc2."date"::date >= (CURRENT_DATE - INTERVAL '30 days')
             AND hc2."date"::date < CURRENT_DATE) AS streak
        FROM "Habit" h
        WHERE h."userId" = ${userId}
          AND h."isArchived" = false
          AND NOT EXISTS (
            SELECT 1 FROM "HabitCompletion" hc
            WHERE hc."habitId" = h.id AND hc."date"::date = ${localDate}::date
          )
        HAVING (SELECT COUNT(*) FROM "HabitCompletion" hc2
                WHERE hc2."habitId" = h.id
                  AND hc2."date"::date >= (CURRENT_DATE - INTERVAL '30 days')
                  AND hc2."date"::date < CURRENT_DATE) > 2
        LIMIT 3
      `.catch(() => [] as { id: string; name: string; streak: number }[])

      if (atRiskHabits.length > 0) {
        const names = atRiskHabits.map(h => h.name).join(", ")
        streakProtectionNotif = {
          title: "🔥 Streak at risk!",
          body: atRiskHabits.length === 1
            ? `Complete "${atRiskHabits[0].name}" before midnight!`
            : `${atRiskHabits.length} habits still need completing tonight`,
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
      const payload = JSON.stringify(notif)
      await Promise.allSettled(
        subs.map(sub =>
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          ).then(() => { totalSent++ }).catch(async (err) => {
            if (err.statusCode === 410) {
              await prisma.$executeRaw`
                DELETE FROM "PushSubscription" WHERE "endpoint" = ${sub.endpoint}
              `.catch(() => {})
            }
          })
        )
      )
    }

    // Mark everything from this pass as delivered. Recorded even if every push
    // failed: a dead subscription would otherwise retry on every run all day.
    if (streakProtectionNotif) alreadySent.add("streak")
    for (const h of habitReminders)  alreadySent.add(`habit:${h.id}`)
    for (const r of reminderAlerts)  alreadySent.add(`reminder:${r.id}`)
    await writeSentLog(userId, localDate, alreadySent)
  }

  return NextResponse.json({ ok: true, sent: totalSent })
}
