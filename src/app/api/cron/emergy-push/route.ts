import { NextRequest, NextResponse } from "next/server"
import { requireCronSecret } from "@/lib/cron-auth"
import { configurePush, loadSubscriptionsByUser, sendToUser } from "@/lib/push"
import { sayAsEmergy } from "@/lib/emergy-say"
import { prisma } from "@/lib/prisma"
import { hydrationMl, HYDRATING_TYPES, resolveWaterGoal, waterNudgeLevel, expectedWaterByNow } from "@/lib/hydration"
import { DEFAULT_GOALS, getGoals } from "@/lib/goals"
import { localDateStr, localTimeStr, zonedDayRange } from "@/lib/local-date"
import { habitsTallyToday, weekStart } from "@/lib/habit-schedule"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60 // an all-user loop

// The drama stays; the abstraction goes. These used to be fixed strings, so
// the 3pm nag read exactly the same whether you had drunk nothing at all or
// were two hundred millilitres short — and a nag that cannot tell those apart
// is one you learn to swipe away. Every line now carries the figure that
// triggered it, which is the one thing this app has that a generic wellness
// reminder does not.
// The clock is the user's real local time: the scream can land any time in
// the window below, and "IT IS 3PM" at 19:40 is the app lying in capitals.
const SCREAM_WATER = [
  (ml: number, time: string) => `${ml}ml TODAY. IT IS ${time}. I AM BEGGING YOU 💧💧💧`,
  (ml: number) => `I HAVE SEEN ${ml}ml GO IN TODAY AND I AM WILTING`,
  (ml: number) => `WATER. NOW. ${ml}ml IS NOT ENOUGH AND YOUR PLANT IS DYING 🌵`,
]
// Behind, but drinking: a word, not a scream. The capitals are kept for a day
// that has barely started, so they still mean something when they arrive.
const NUDGE_WATER = [
  (ml: number, behind: number) => `${ml}ml so far — about ${behind}ml behind where I'd like us by now. A glass? 💧`,
  (ml: number, behind: number, time: string) => `${time} and ${ml}ml in. We're ${behind}ml off pace — one glass closes most of it 🌱`,
]
const SCREAM_HABITS = [
  (done: number, total: number, time: string) => `${done} OF ${total} HABITS. IT IS ${time}. WE ARE BOTH SUFFERING 😭`,
  (done: number, total: number) => `${total - done} HABITS STILL UNDONE... IT IS ALMOST TOO LATE`,
  (done: number, total: number) => `${done}/${total} DONE. FINISH THEM OR I DROP ALL MY LEAVES`,
]

// Emergy's afternoon nudge, from 15:00 in each user's OWN afternoon.
//
// This used to run once at 15:00 UTC and check `getUTCHours() === 15` — which
// is 17:00 in a Prague summer, 16:00 in winter, and the middle of the night
// for anyone further away; and "today's water" was measured from UTC
// midnight. Now every tick of the reminders workflow considers each
// subscribed user against their own clock, and a per-day sent marker means
// one evaluation per day however many ticks fall inside the window.
//
// A window, not the 15:00 hour alone: that workflow asks for every ten
// minutes and GitHub has run it 3–5 hours apart, so an hour-wide target was
// missed on whole days. The first tick from 15:00 until 21:00 decides; the
// daily Vercel cron at 15:00 UTC lands inside it for Central Europe as a
// backstop. The decision is made once, at the first tick in the window: one
// push a day is the whole budget, and a user judged on pace then is not
// chased again as the evening's expectation climbs.
const NUDGE_HOUR = 15
const NUDGE_UNTIL_HOUR = 21
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

  // Who is inside their afternoon window right now and hasn't been considered today?
  const due: { userId: string; today: string; dayStart: Date; time: string }[] = []
  for (const userId of userIds) {
    const tz = tzByUser.get(userId)?.trim() || "UTC"
    const time = localTimeStr(tz)
    const hour = Number(time.slice(0, 2))
    if (hour < NUDGE_HOUR || hour >= NUDGE_UNTIL_HOUR) continue
    const today = localDateStr(tz)
    if (sentByUser.get(userId) === today) continue
    due.push({ userId, today, dayStart: zonedDayRange(tz, today).start, time })
  }
  if (due.length === 0) return NextResponse.json({ ok: true, sent: 0, due: 0, total: subsByUser.size })

  const dueIds = due.map(d => d.userId)
  const earliestStart = new Date(Math.min(...due.map(d => d.dayStart.getTime())))
  const earliestDay = due.map(d => d.today).sort()[0]

  const [intakes, habits, completions, skips, checkins, goalsByUser] = await Promise.all([
    prisma.intakeLog.findMany({
      where: { userId: { in: dueIds }, type: { in: HYDRATING_TYPES }, loggedAt: { gte: earliestStart } },
      select: { userId: true, amountMl: true, type: true, loggedAt: true },
    }),
    prisma.habit.findMany({
      where: { userId: { in: dueIds }, isArchived: false },
      select: { id: true, userId: true, scheduleDays: true, timesPerWeek: true },
    }),
    // From the start of the week: an N-times-a-week habit is due today only
    // while this week's quota is unmet.
    prisma.habitCompletion.findMany({
      where: { userId: { in: dueIds }, date: { gte: new Date(weekStart(earliestDay) + "T00:00:00Z") } },
      select: { habitId: true, date: true },
    }).catch(() => [] as { habitId: string; date: Date }[]),
    prisma.habitSkip.findMany({
      where: { userId: { in: dueIds }, date: { gte: new Date(earliestDay + "T00:00:00Z") } },
      select: { habitId: true, date: true },
    }).catch(() => [] as { habitId: string; date: Date }[]),
    prisma.morningCheckIn.findMany({
      where: { userId: { in: dueIds }, date: { in: [...new Set(due.map(d => d.today))] } },
      select: { userId: true, date: true, waterGoalMl: true },
    }).catch(() => [] as { userId: string; date: string; waterGoalMl: number | null }[]),
    // Read alongside everything else, not one user at a time inside the send loop.
    Promise.all(dueIds.map(async id => [id, (await getGoals(id)).waterMl] as const)).then(e => new Map(e)),
  ])

  // Date-only columns: the ISO date IS the day each row was filed under.
  const byHabit = (rows: { habitId: string; date: Date }[]) => {
    const m = new Map<string, Set<string>>()
    for (const r of rows) {
      const s = m.get(r.habitId) ?? new Set<string>()
      s.add(r.date.toISOString().slice(0, 10))
      m.set(r.habitId, s)
    }
    return m
  }
  const completionsByHabit = byHabit(completions)
  const skipsByHabit = byHabit(skips)

  let sent = 0
  await Promise.allSettled(due.map(async ({ userId, today, dayStart, time }) => {
    const subs = subsByUser.get(userId)
    if (!subs) return
    const water = intakes
      .filter(i => i.userId === userId && i.loggedAt >= dayStart)
      .reduce((sum, i) => sum + hydrationMl(i.type, i.amountMl), 0)
    const { due: totalHabits, done: doneHabits } = habitsTallyToday(
      habits.filter(h => h.userId === userId).map(h => ({
        schedule: { scheduleDays: h.scheduleDays ?? [], timesPerWeek: h.timesPerWeek ?? null },
        completionDays: completionsByHabit.get(h.id) ?? new Set<string>(),
        skipDays: skipsByHabit.get(h.id) ?? new Set<string>(),
      })),
      today,
    )
    const habitPct = totalHabits > 0 ? (doneHabits / totalHabits) * 100 : 100
    const checkinGoal = checkins.find(c => c.userId === userId && c.date === today)?.waterGoalMl
    const waterGoal = resolveWaterGoal(checkinGoal, goalsByUser.get(userId) ?? DEFAULT_GOALS.waterMl)
    const waterLevel = waterNudgeLevel(water, waterGoal, time)

    let message: string | null = null
    let tag = "emergy"
    let url = "/dashboard"
    const pick = Math.floor(Date.now() / 86400000)
    if (waterLevel === "scream") {
      message = SCREAM_WATER[pick % SCREAM_WATER.length](Math.round(water), time)
      tag = "water"; url = "/dashboard/intake"
    } else if (habitPct < 50) {
      message = SCREAM_HABITS[pick % SCREAM_HABITS.length](doneHabits, totalHabits, time)
      tag = "habit"; url = "/dashboard/habits"
    } else if (waterLevel === "nudge") {
      const behind = Math.round((expectedWaterByNow(waterGoal, time) - water) / 50) * 50
      message = NUDGE_WATER[pick % NUDGE_WATER.length](Math.round(water), behind, time)
      tag = "water"; url = "/dashboard/intake"
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
    if (delivered) {
      sent++
      // The same courtesy every other proactive cron pays: the scream becomes
      // a real message in a real conversation, so Emergy knows he said it and
      // the user can answer it instead of just dismissing it.
      await sayAsEmergy(userId, message).catch(() => null)
    }
  }))

  return NextResponse.json({ ok: true, sent, due: due.length, total: subsByUser.size })
}
