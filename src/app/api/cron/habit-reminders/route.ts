import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
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

  let totalSent = 0

  for (const [userId, subs] of byUser) {
    // Get user timezone
    const tzRows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM "UserPreference" WHERE "userId" = ${userId} AND key = 'timezone' LIMIT 1
    `.catch(() => [] as { value: string }[])
    const timezone = tzRows[0]?.value ?? "UTC"

    const localTime = getCurrentHHMM(timezone)
    const localDate = getLocalDateStr(timezone)

    // Find incomplete habits with reminderTime matching this exact HH:MM
    const habitReminders = await prisma.$queryRaw<{ id: string; name: string; reminderTime: string }[]>`
      SELECT h.id, h.name, h."reminderTime"
      FROM "Habit" h
      WHERE h."userId" = ${userId}
        AND h."isArchived" = false
        AND h."reminderTime" IS NOT NULL
        AND h."reminderTime" = ${localTime}
        AND NOT EXISTS (
          SELECT 1 FROM "HabitCompletion" hc
          WHERE hc."habitId" = h.id AND hc."date"::date = ${localDate}::date
        )
    `.catch(() => [] as { id: string; name: string; reminderTime: string }[])

    // Find reminders due today/overdue with reminderTime matching this exact HH:MM, not completed
    const reminderAlerts = await prisma.$queryRaw<{ id: string; title: string; reminderTime: string }[]>`
      SELECT id, title, "reminderTime"
      FROM "Reminder"
      WHERE "userId" = ${userId}
        AND "isCompleted" = false
        AND "reminderTime" IS NOT NULL
        AND "reminderTime" = ${localTime}
        AND "dueDate"::date <= ${localDate}::date
    `.catch(() => [] as { id: string; title: string; reminderTime: string }[])

    // Streak protection: at 21:00 local time, warn about habits with streaks at risk
    let streakProtectionNotif: { title: string; body: string; url: string; tag: string; requireInteraction: boolean } | null = null
    if (localTime === "21:00") {
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
  }

  return NextResponse.json({ ok: true, sent: totalSent })
}
