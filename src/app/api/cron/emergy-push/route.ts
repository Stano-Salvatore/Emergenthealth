import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { prisma } from "@/lib/prisma"
import { hydrationMl, HYDRATING_TYPES } from "@/lib/hydration"
import { localDateStr, localTimeStr, zonedDayRange } from "@/lib/local-date"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SCREAM_WATER = [
  "PLEASE DRINK WATER I AM BEGGING YOU 💧💧💧",
  "I HAVEN'T SEEN YOU DRINK ANYTHING TODAY AND I AM WILTING",
  "WATER. NOW. YOUR PLANT IS DYING 🌵",
]
const SCREAM_HABITS = [
  "YOUR HABITS ARE SUFFERING AND SO AM I 😭",
  "WE HAVEN'T DONE OUR HABITS YET... IT IS ALMOST TOO LATE",
  "COMPLETE YOUR HABITS OR I WILL DROP ALL MY LEAVES",
]

// Emergy's afternoon nudge, at 15:00 in each user's OWN afternoon.
//
// This used to run once at 15:00 UTC and check `getUTCHours() === 15` — which
// is 17:00 in a Prague summer, 16:00 in winter, and the middle of the night
// for anyone further away; and "today's water" was measured from UTC
// midnight. Now every ten-minute tick (the reminders workflow) considers each
// subscribed user against their own clock, and a per-day sent marker means
// one evaluation per day however many ticks fall inside that hour. The
// decision is made once because it can only go one way after 15:00: water
// only rises and habits only get completed, so a user who was fine at the
// first tick stays fine.
const NUDGE_HOUR = 15
const SENT_KEY = "emergy_push:sent"

export async function GET(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  if (!configurePush()) return NextResponse.json({ error: "VAPID keys not configured" }, { status: 500 })

  const subsByUser = await loadSubscriptionsByUser()
  if (subsByUser.size === 0) return NextResponse.json({ ok: true, sent: 0 })
  const userIds = [...subsByUser.keys()]

  const prefs = await prisma.userPreference.findMany({
    where: { userId: { in: userIds }, key: { in: ["timezone", SENT_KEY] } },
    select: { userId: true, key: true, value: true },
  }).catch(() => [] as { userId: string; key: string; value: string }[])
  const tzByUser = new Map<string, string>()
  const sentByUser = new Map<string, string>()
  for (const p of prefs) (p.key === "timezone" ? tzByUser : sentByUser).set(p.userId, p.value)

  // Who is inside their 15:00 hour right now and hasn't been considered today?
  const due: { userId: string; today: string; dayStart: Date }[] = []
  for (const userId of userIds) {
    const tz = tzByUser.get(userId)?.trim() || "UTC"
    if (Number(localTimeStr(tz).slice(0, 2)) !== NUDGE_HOUR) continue
    const today = localDateStr(tz)
    if (sentByUser.get(userId) === today) continue
    due.push({ userId, today, dayStart: zonedDayRange(tz, today).start })
  }
  if (due.length === 0) return NextResponse.json({ ok: true, sent: 0, due: 0, total: subsByUser.size })

  const dueIds = due.map(d => d.userId)
  const earliestStart = new Date(Math.min(...due.map(d => d.dayStart.getTime())))
  const earliestDay = due.map(d => d.today).sort()[0]

  const [intakes, habits, completions] = await Promise.all([
    prisma.intakeLog.findMany({
      where: { userId: { in: dueIds }, type: { in: HYDRATING_TYPES }, loggedAt: { gte: earliestStart } },
      select: { userId: true, amountMl: true, type: true, loggedAt: true },
    }),
    prisma.habit.findMany({
      where: { userId: { in: dueIds }, isArchived: false },
      select: { userId: true },
    }),
    prisma.habitCompletion.findMany({
      where: { userId: { in: dueIds }, date: { gte: new Date(earliestDay + "T00:00:00Z") } },
      select: { userId: true, date: true },
    }).catch(() => [] as { userId: string; date: Date }[]),
  ])

  const habitsByUser = new Map<string, number>()
  for (const h of habits) habitsByUser.set(h.userId, (habitsByUser.get(h.userId) ?? 0) + 1)

  let sent = 0
  await Promise.allSettled(due.map(async ({ userId, today, dayStart }) => {
    const subs = subsByUser.get(userId)
    if (!subs) return
    const water = intakes
      .filter(i => i.userId === userId && i.loggedAt >= dayStart)
      .reduce((sum, i) => sum + hydrationMl(i.type, i.amountMl), 0)
    const totalHabits = habitsByUser.get(userId) ?? 0
    // A date-only column: its ISO date IS the day it was filed under.
    const doneHabits = completions.filter(c => c.userId === userId && c.date.toISOString().slice(0, 10) === today).length
    const habitPct = totalHabits > 0 ? (doneHabits / totalHabits) * 100 : 100

    let message: string | null = null
    let tag = "emergy"
    let url = "/dashboard"
    if (water < 1500) {
      message = SCREAM_WATER[Math.floor(Date.now() / 86400000) % SCREAM_WATER.length]
      tag = "water"; url = "/dashboard/intake"
    } else if (habitPct < 50) {
      message = SCREAM_HABITS[Math.floor(Date.now() / 86400000) % SCREAM_HABITS.length]
      tag = "habit"; url = "/dashboard/habits"
    }

    // Marked before sending: a delivery failure should not turn into six
    // retries of the same scream across the hour.
    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: SENT_KEY } },
      create: { userId, key: SENT_KEY, value: today },
      update: { value: today },
    }).catch(() => null)

    if (!message) return
    const delivered = await sendToUser(subs, {
      title: "Emergy 🌱",
      body: message,
      url,
      tag,
      requireInteraction: habitPct < 50,
    })
    if (delivered) sent++
  }))

  return NextResponse.json({ ok: true, sent, due: due.length, total: subsByUser.size })
}
