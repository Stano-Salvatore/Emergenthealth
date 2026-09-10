import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserPlan } from "@/lib/plan"
import { localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { getVacationWindow, makeIsFrozen } from "@/lib/streak"
import { habitStreak, isDueOn, isScheduledOn, normalizeSchedule, scheduleLabel } from "@/lib/habit-schedule"

const FREE_HABIT_LIMIT = 10

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // The user's day, not the server's — completions are filed under the date
  // shown on the user's phone, so "today" has to mean the same thing here.
  const timezone = await getUserTimezone(session.user.id)
  const todayStr = localDateStr(timezone)
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1"

  const today = new Date(todayStr + "T00:00:00Z")
  const plan = await getUserPlan(session.user.id)
  const historyDays = plan === "pro" ? 730 : 30
  const historyFrom = new Date(today)
  historyFrom.setUTCDate(today.getUTCDate() - historyDays - 1)

  const habits = await prisma.habit.findMany({
    where: { userId: session.user.id, ...(includeArchived ? {} : { isArchived: false }) },
    include: {
      completions: {
        where: { date: { gte: historyFrom } },
        orderBy: { date: "desc" },
      },
      skips: {
        where: { date: { gte: historyFrom } },
        orderBy: { date: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  // Vacation mode and the streak walk itself live in lib/streak so the garden
  // computes the same answer (it used to have its own, freeze-blind version).
  const isFrozen = makeIsFrozen(await getVacationWindow(session.user.id))

  const result = habits.map((h) => {
    const completionDates = new Set(h.completions.map((c) => c.date.toISOString().split("T")[0]))
    const skipDates = new Set(h.skips.map((s) => s.date.toISOString().split("T")[0]))
    const schedule = { scheduleDays: h.scheduleDays, timesPerWeek: h.timesPerWeek }
    const { streak, unit } = habitStreak(schedule, completionDates, skipDates, todayStr, isFrozen)
    const todaySkip = h.skips.find(s => s.date.toISOString().split("T")[0] === todayStr) ?? null
    return {
      ...h,
      skips: h.skips.map(s => ({ date: s.date, reason: s.reason })),
      streak,
      streakUnit: unit,
      completedToday: completionDates.has(todayStr),
      skippedToday: todaySkip != null,
      skipReason: todaySkip?.reason ?? null,
      // Whether the schedule asks for it today at all. Off-days keep their
      // card but don't count in "done today", don't ring and can't be missed.
      dueToday: isDueOn(schedule, todayStr, completionDates),
      scheduledToday: isScheduledOn(schedule, todayStr),
      scheduleLabel: scheduleLabel(schedule),
      frozen: isFrozen(todayStr),
    }
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { name, description, color, icon, reminderTime } = body
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  // Enforce free-tier habit limit
  const plan = await getUserPlan(session.user.id)
  if (plan === "free") {
    const count = await prisma.habit.count({ where: { userId: session.user.id, isArchived: false } })
    if (count >= FREE_HABIT_LIMIT) {
      return NextResponse.json({ error: "Free plan is limited to 10 habits. Upgrade to Pro for unlimited habits.", upgrade: true }, { status: 403 })
    }
  }

  const schedule = normalizeSchedule(body)
  const habit = await prisma.habit.create({
    data: {
      userId: session.user.id,
      name,
      description,
      color: color ?? "#6366f1",
      icon,
      reminderTime: reminderTime || null,
      scheduleDays: schedule.scheduleDays,
      timesPerWeek: schedule.timesPerWeek,
    },
  })

  return NextResponse.json(habit, { status: 201 })
}
