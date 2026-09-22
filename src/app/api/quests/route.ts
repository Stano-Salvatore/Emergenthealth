import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { localDateStr, zonedDayRange } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { sumHydration, HYDRATING_TYPES } from "@/lib/hydration"
import { loadMoodByDay } from "@/lib/mood-series"
import { getGoals } from "@/lib/goals"
import { isDueOn } from "@/lib/habit-schedule"
import { latestWeighIn } from "@/lib/weight-series"

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export interface Quest {
  id: string
  emoji: string
  title: string
  desc: string
  done: boolean
  xp: number
  type: "habit" | "water" | "mood" | "sleep" | "journal" | "focus" | "weight" | "checkin"
  link?: string
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  // The user's day, not the server's — on UTC hosting, server-midnight quests
  // rolled over at 01:00/02:00 for a Bratislava user (the garden already does
  // this correctly).
  const timezone = await getUserTimezone(userId)
  const todayStr = localDateStr(timezone)
  const today = zonedDayRange(timezone, todayStr).start

  // A weekly-target habit is "due" by the week's other days, so the
  // schedule needs the recent completions, not just today's.
  const since = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)

  const [
    allHabits,
    waterToday,
    moodByDay,
    healthToday,
    noteToday,
    focusToday,
    recentWeight,
    checkinToday,
    goals,
  ] = await Promise.all([
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      orderBy: { createdAt: "asc" },
      include: {
        completions: { where: { date: { gte: since } }, select: { date: true } },
        skips: { where: { date: { gte: since } }, select: { date: true } },
      },
    }),
    prisma.intakeLog.findMany({ where: { userId, type: { in: HYDRATING_TYPES }, loggedAt: { gte: today } }, select: { amountMl: true, type: true } }),
    // Both mood tables. The mood quest read MoodLog alone, so the card said
    // "Log your mood" all day under a check-in quest that had just reported
    // "Energy & mood logged" — the same card contradicting itself.
    loadMoodByDay(userId, todayStr, todayStr),
    prisma.healthLog.findFirst({ where: { userId, date: { gte: today } }, select: { id: true } }),
    // DailyNote.date is a Date column: passing the "YYYY-MM-DD" string threw
    // "premature end of input. Expected ISO-8601 DateTime" on every request,
    // so the journal quest never reported as done.
    prisma.dailyNote.findFirst({ where: { userId, date: { gte: today } }, select: { id: true } }),
    prisma.focusSession.findFirst({ where: { userId, type: "focus", startedAt: { gte: today } }, select: { id: true } }),
    // Both weight tables: the Body page's form writes BodyMeasurement, and
    // "Last logged never" was what a year of those looked like from here.
    latestWeighIn(userId),
    prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MorningCheckIn" WHERE "userId" = ${userId} AND "date" = ${todayStr} LIMIT 1`.catch(() => [] as { id: string }[]),
    getGoals(userId),
  ])

  // Only what the schedule asks for today. A habit on its off day, or one
  // skipped today on purpose, is not "left undone" — the widget and the
  // Habits page already read it that way, and this card nagged anyway.
  const habits = allHabits.flatMap(h => {
    const days = new Set(h.completions.map(c => isoDay(c.date)))
    const skipDays = new Set(h.skips.map(s => isoDay(s.date)))
    const schedule = { scheduleDays: h.scheduleDays, timesPerWeek: h.timesPerWeek }
    if (!isDueOn(schedule, todayStr, days) && !days.has(todayStr)) return []
    return [{ id: h.id, name: h.name, icon: h.icon, doneToday: days.has(todayStr) || skipDays.has(todayStr) }]
  }).slice(0, 5)
  const moodToday = moodByDay.has(todayStr)
  const completedHabitIds = new Set(habits.filter(h => h.doneToday).map(h => h.id))
  const waterMl = sumHydration(waterToday)
  const daysSinceWeight = recentWeight
    ? Math.floor((Date.now() - new Date(recentWeight.date + "T00:00:00Z").getTime()) / 86400000)
    : 999
  const hasCheckin = Array.isArray(checkinToday) && checkinToday.length > 0

  const quests: Quest[] = []

  // Morning check-in quest
  quests.push({
    id: "checkin",
    emoji: "🌅",
    title: hasCheckin ? "Morning check-in done!" : "Do your morning check-in",
    desc: hasCheckin ? "Energy & mood logged" : "Set your energy, mood & intention",
    done: hasCheckin,
    xp: 10,
    type: "checkin",
    link: "/dashboard/checkin",
  })

  // New-user bootstrap quest: no habits yet
  if (habits.length === 0) {
    quests.push({
      id: "create_habit",
      emoji: "🌱",
      title: "Create your first habit",
      desc: "Start building healthy routines",
      done: false,
      xp: 20,
      type: "habit",
      link: "/dashboard/habits",
    })
  }

  // Habit quests — pick up to 2 incomplete habits
  const incompleteHabits = habits.filter(h => !completedHabitIds.has(h.id))
  for (const h of incompleteHabits.slice(0, 2)) {
    quests.push({
      id: `habit:${h.id}`,
      emoji: h.icon ?? "✅",
      title: `Complete "${h.name}"`,
      desc: "Keep your streak alive",
      done: false,
      xp: 10,
      type: "habit",
      link: "/dashboard/habits",
    })
  }
  // If all habits done today, show a completed one
  if (incompleteHabits.length === 0 && habits.length > 0) {
    quests.push({
      id: "all_habits",
      emoji: "🌟",
      title: "All habits complete!",
      desc: `Completed all ${habits.length} habits today`,
      done: true,
      xp: 10 * habits.length,
      type: "habit",
      link: "/dashboard/habits",
    })
  }

  // Water quest — against the goal the user set, not a number of our own.
  const waterTarget = goals.waterMl
  quests.push({
    id: "water",
    emoji: "💧",
    title: waterMl >= waterTarget ? "Hydration goal reached!" : `Drink ${Math.max(0, waterTarget - waterMl)}ml more water`,
    desc: `${waterMl}ml / ${waterTarget}ml today`,
    done: waterMl >= waterTarget,
    xp: 5,
    type: "water",
    link: "/dashboard/intake",
  })

  // Mood quest
  quests.push({
    id: "mood",
    emoji: "😊",
    title: moodToday ? "Mood logged today!" : "Log your mood",
    desc: moodToday ? "You checked in today" : "How are you feeling?",
    done: !!moodToday,
    xp: 5,
    type: "mood",
    link: "/dashboard/checkin",
  })

  // Sleep/health quest
  quests.push({
    id: "sleep",
    emoji: "💤",
    title: healthToday ? "Sleep logged!" : "Log last night's sleep",
    desc: healthToday ? "Health data tracked" : "Track your recovery",
    done: !!healthToday,
    xp: 5,
    type: "sleep",
    link: "/dashboard/health",
  })

  // Journal quest
  quests.push({
    id: "journal",
    emoji: "📝",
    title: noteToday ? "Journal written!" : "Write in your journal",
    desc: noteToday ? "Reflection done" : "Capture today's thoughts",
    done: !!noteToday,
    xp: 10,
    type: "journal",
    link: "/dashboard/journal",
  })

  // Focus session quest
  quests.push({
    id: "focus",
    emoji: "🎯",
    title: focusToday ? "Focus session done!" : "Complete a focus session",
    desc: focusToday ? "Deep work achieved" : "25 min of deep work",
    done: !!focusToday,
    xp: 10,
    type: "focus",
    link: "/dashboard/focus",
  })

  // Weight quest (show if not logged in 3+ days)
  if (daysSinceWeight >= 3) {
    quests.push({
      id: "weight",
      emoji: "⚖️",
      title: "Log your weight",
      desc: `Last logged ${daysSinceWeight >= 999 ? "never" : `${daysSinceWeight}d ago`}`,
      done: false,
      xp: 3,
      type: "weight",
      link: "/dashboard/weight",
    })
  }

  // Return top 5 quests — prioritise incomplete ones, then completed
  const sorted = [
    ...quests.filter(q => !q.done),
    ...quests.filter(q => q.done),
  ].slice(0, 5)

  const totalXp = sorted.filter(q => q.done).reduce((s, q) => s + q.xp, 0)
  const maxXp   = sorted.reduce((s, q) => s + q.xp, 0)

  return NextResponse.json({ quests: sorted, totalXp, maxXp })
}
