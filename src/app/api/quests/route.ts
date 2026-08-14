import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserTimezone, localDateStr, zonedDayRange } from "@/lib/local-date"
import { sumHydration, HYDRATING_TYPES } from "@/lib/hydration"

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

  const [
    habits,
    completionsToday,
    waterToday,
    moodToday,
    healthToday,
    noteToday,
    focusToday,
    recentWeight,
    checkinToday,
  ] = await Promise.all([
    prisma.habit.findMany({ where: { userId, isArchived: false }, select: { id: true, name: true, icon: true }, orderBy: { createdAt: "asc" }, take: 5 }),
    prisma.habitCompletion.findMany({ where: { userId, date: { gte: today } }, select: { habitId: true } }),
    prisma.intakeLog.findMany({ where: { userId, type: { in: HYDRATING_TYPES }, loggedAt: { gte: today } }, select: { amountMl: true, type: true } }),
    prisma.moodLog.findFirst({ where: { userId, date: { gte: today } }, select: { id: true } }),
    prisma.healthLog.findFirst({ where: { userId, date: { gte: today } }, select: { id: true } }),
    // DailyNote.date is a Date column: passing the "YYYY-MM-DD" string threw
    // "premature end of input. Expected ISO-8601 DateTime" on every request,
    // so the journal quest never reported as done.
    prisma.dailyNote.findFirst({ where: { userId, date: { gte: today } }, select: { id: true } }),
    prisma.focusSession.findFirst({ where: { userId, type: "focus", startedAt: { gte: today } }, select: { id: true } }),
    prisma.healthLog.findFirst({ where: { userId, weight: { not: null } }, orderBy: { date: "desc" }, select: { date: true } }),
    prisma.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MorningCheckIn" WHERE "userId" = ${userId} AND "date" = ${todayStr} LIMIT 1`.catch(() => [] as { id: string }[]),
  ])

  const completedHabitIds = new Set(completionsToday.map(c => c.habitId))
  const waterMl = sumHydration(waterToday)
  const daysSinceWeight = recentWeight
    ? Math.floor((Date.now() - new Date(recentWeight.date).getTime()) / 86400000)
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

  // Water quest
  const waterTarget = 2000
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
