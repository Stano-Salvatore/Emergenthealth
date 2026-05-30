import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { getLevel } from "@/lib/xp"

interface GitHubProfileRow {
  username: string
  accessToken: string | null
}

interface PushEvent {
  type: string
  created_at: string
  payload: {
    commits?: { sha: string }[]
    size?: number
  }
}

function currentStreak(sortedDates: string[]): number {
  if (!sortedDates.length) return 0
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const set = new Set(sortedDates)
  const start = set.has(today) ? today : set.has(yesterday) ? yesterday : null
  if (!start) return 0
  let streak = 0
  let cur = new Date(start)
  while (set.has(cur.toISOString().slice(0, 10))) {
    streak++
    cur = new Date(cur.getTime() - 86400000)
  }
  return streak
}

function longestStreak(sortedDates: string[]): number {
  if (!sortedDates.length) return 0
  let best = 1, cur = 1
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1])
    const curr = new Date(sortedDates[i])
    const diff = (curr.getTime() - prev.getTime()) / 86400000
    if (diff === 1) { cur++; best = Math.max(best, cur) }
    else cur = 1
  }
  return best
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const since = new Date(Date.now() - 365 * 86400000)

  const [habits, completions, healthLogs, moodLogs, dailyNotes, intakeDays, focusSessions, finishedBooks, ouraTagDays, githubProfile] = await Promise.all([
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      select: { id: true, name: true, color: true, icon: true },
    }),
    prisma.habitCompletion.findMany({
      where: { userId, date: { gte: since } },
      select: { habitId: true, date: true },
      orderBy: { date: "asc" },
    }),
    prisma.healthLog.count({ where: { userId } }),
    prisma.moodLog.count({ where: { userId } }),
    prisma.dailyNote.count({ where: { userId } }),
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: since } },
      select: { loggedAt: true },
    }),
    prisma.focusSession.findMany({
      where: { userId, type: "focus" },
      select: { id: true },
    }),
    prisma.book.count({ where: { userId, status: "done" } }),
    // Unique days where the user logged a supplement/med via Oura Ring
    prisma.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT "day" FROM "OuraTag"
      WHERE "userId" = ${userId}
        AND "tagName" IS NOT NULL
        AND "tagName" != ''
        AND "tagName" NOT ILIKE '%coffee%'
        AND "tagName" NOT ILIKE '%water%'
        AND "tagName" NOT ILIKE '%tea%'
        AND "tagName" NOT ILIKE '%beer%'
        AND "tagName" NOT ILIKE '%wine%'
        AND "tagName" NOT ILIKE '%ml%'
    `.catch(() => [] as { day: string }[]),
    prisma.$queryRaw<GitHubProfileRow[]>`
      SELECT "username", "accessToken" FROM "GitHubProfile" WHERE "userId" = ${userId} LIMIT 1
    `.catch(() => [] as GitHubProfileRow[]),
  ])

  // GitHub commit data
  let githubCommitDays = 0
  let githubStreak = 0
  const profile = (githubProfile as GitHubProfileRow[])[0]
  if (profile) {
    const headers: Record<string, string> = {
      "User-Agent": "emergenthealth/1.0",
      Accept: "application/vnd.github+json",
    }
    if (profile.accessToken) headers["Authorization"] = `Bearer ${profile.accessToken}`
    const eventsRes = await fetch(
      `https://api.github.com/users/${profile.username}/events?per_page=100`,
      { headers },
    ).catch(() => null)
    if (eventsRes?.ok) {
      const events: PushEvent[] = await eventsRes.json().catch(() => [])
      const commitsByDay: Record<string, number> = {}
      for (const event of events) {
        if (event.type !== "PushEvent") continue
        const day = event.created_at.slice(0, 10)
        const count = event.payload.commits?.length ?? event.payload.size ?? 0
        commitsByDay[day] = (commitsByDay[day] ?? 0) + count
      }
      const commitDays = Object.keys(commitsByDay).filter(d => (commitsByDay[d] ?? 0) > 0)
      githubCommitDays = commitDays.length
      githubStreak = currentStreak(commitDays.sort())
    }
  }

  // per-habit streaks
  const byHabit = new Map<string, string[]>()
  for (const c of completions) {
    const key = c.habitId
    const dateStr = (c.date as Date).toISOString().slice(0, 10)
    if (!byHabit.has(key)) byHabit.set(key, [])
    byHabit.get(key)!.push(dateStr)
  }

  const habitStreaks = habits.map(h => {
    const dates = byHabit.get(h.id) ?? []
    return {
      id: h.id,
      name: h.name,
      color: h.color,
      icon: h.icon ?? null,
      currentStreak: currentStreak(dates),
      longestStreak: longestStreak(dates),
      totalCompletions: dates.length,
    }
  })

  const maxCurrentStreak = Math.max(0, ...habitStreaks.map(h => h.currentStreak))
  const maxLongestStreak = Math.max(0, ...habitStreaks.map(h => h.longestStreak))

  // XP
  const habitXp = completions.length * 10
  const sleepXp = healthLogs * 5
  const weightLogs = await prisma.healthLog.count({ where: { userId, weight: { not: null } } })
  const weightXp = weightLogs * 3
  const moodXp = moodLogs * 5
  const journalXp = dailyNotes * 10
  const intakeDateSet = new Set(intakeDays.map(l => (l.loggedAt as Date).toISOString().slice(0, 10)))
  const intakeXp = intakeDateSet.size * 5
  const focusXp = focusSessions.length * 10
  const readingXp = finishedBooks * 20
  const supplementDays = (ouraTagDays as { day: string }[]).length
  const supplementXp = supplementDays * 5
  const githubXp = githubCommitDays * 8
  const totalXp = habitXp + sleepXp + weightXp + moodXp + journalXp + intakeXp + focusXp + readingXp + supplementXp + githubXp
  const levelInfo = getLevel(totalXp)

  // achievements
  const allCompletionDates = [...new Set(completions.map(c => (c.date as Date).toISOString().slice(0, 10)))]
  const allHabitDone = habits.length >= 3
    ? (() => {
        const byDate = new Map<string, Set<string>>()
        for (const c of completions) {
          const d = (c.date as Date).toISOString().slice(0, 10)
          if (!byDate.has(d)) byDate.set(d, new Set())
          byDate.get(d)!.add(c.habitId)
        }
        return [...byDate.values()].filter(s => s.size >= habits.length).length
      })()
    : 0

  const achievements = [
    { id: "first_habit",    emoji: "🌱", title: "First Steps",      desc: "Complete your first habit",            unlocked: completions.length >= 1,    progress: Math.min(1, completions.length),   target: 1 },
    { id: "week_streak",    emoji: "🔥", title: "Week Warrior",     desc: "7-day habit streak",                   unlocked: maxCurrentStreak >= 7,        progress: Math.min(7, maxCurrentStreak),     target: 7 },
    { id: "month_streak",   emoji: "💎", title: "Month Master",     desc: "30-day habit streak",                  unlocked: maxLongestStreak >= 30,        progress: Math.min(30, maxLongestStreak),    target: 30 },
    { id: "all_habits",     emoji: "⭐", title: "All In",           desc: "Complete all habits on the same day",  unlocked: allHabitDone >= 1,            progress: Math.min(1, allHabitDone),         target: 1 },
    { id: "sleep_7",        emoji: "💤", title: "Sleep Tracker",    desc: "Log sleep 7 days",                     unlocked: healthLogs >= 7,              progress: Math.min(7, healthLogs),           target: 7 },
    { id: "sleep_30",       emoji: "🌙", title: "Sleep Devotee",    desc: "Log sleep 30 days",                    unlocked: healthLogs >= 30,             progress: Math.min(30, healthLogs),          target: 30 },
    { id: "weight_5",       emoji: "⚖️", title: "Scale Starter",    desc: "Log your weight 5 times",              unlocked: weightLogs >= 5,              progress: Math.min(5, weightLogs),           target: 5 },
    { id: "weight_30",      emoji: "📉", title: "Weight Watcher",   desc: "Log your weight 30 times",             unlocked: weightLogs >= 30,             progress: Math.min(30, weightLogs),          target: 30 },
    { id: "mood_7",         emoji: "😊", title: "Mood Logger",      desc: "Log your mood 7 times",                unlocked: moodLogs >= 7,                progress: Math.min(7, moodLogs),             target: 7 },
    { id: "mood_30",        emoji: "🧠", title: "Emotional IQ",     desc: "Log your mood 30 times",               unlocked: moodLogs >= 30,               progress: Math.min(30, moodLogs),            target: 30 },
    { id: "focus_5",        emoji: "🎯", title: "Focus Starter",    desc: "Complete 5 focus sessions",            unlocked: focusSessions.length >= 5,    progress: Math.min(5, focusSessions.length), target: 5 },
    { id: "focus_25",       emoji: "🧘", title: "Flow State",       desc: "Complete 25 focus sessions",           unlocked: focusSessions.length >= 25,   progress: Math.min(25, focusSessions.length),target: 25 },
    { id: "journal_5",      emoji: "📝", title: "Journaler",        desc: "Write 5 daily notes",                  unlocked: dailyNotes >= 5,              progress: Math.min(5, dailyNotes),           target: 5 },
    { id: "journal_15",     emoji: "✍️", title: "Wordsmith",        desc: "Write 15 daily notes",                 unlocked: dailyNotes >= 15,             progress: Math.min(15, dailyNotes),          target: 15 },
    { id: "intake_7",       emoji: "💧", title: "Hydrated",         desc: "Log intake on 7 different days",       unlocked: intakeDateSet.size >= 7,      progress: Math.min(7, intakeDateSet.size),   target: 7 },
    { id: "intake_30",      emoji: "🌊", title: "Hydration Hero",   desc: "Log intake on 30 different days",      unlocked: intakeDateSet.size >= 30,     progress: Math.min(30, intakeDateSet.size),  target: 30 },
    { id: "book_1",         emoji: "📚", title: "Bookworm",         desc: "Finish your first book",               unlocked: finishedBooks >= 1,           progress: Math.min(1, finishedBooks),        target: 1 },
    { id: "book_5",         emoji: "🏛️", title: "Avid Reader",      desc: "Finish 5 books",                       unlocked: finishedBooks >= 5,           progress: Math.min(5, finishedBooks),        target: 5 },
    { id: "supplement_7",   emoji: "💊", title: "Consistent",       desc: "Log supplements via Oura 7 days",      unlocked: supplementDays >= 7,          progress: Math.min(7, supplementDays),       target: 7 },
    { id: "supplement_30",  emoji: "🌿", title: "Supplement Pro",   desc: "Log supplements via Oura 30 days",     unlocked: supplementDays >= 30,         progress: Math.min(30, supplementDays),      target: 30 },
    { id: "github_7",       emoji: "💻", title: "Committed",        desc: "Code for 7 days",                      unlocked: githubCommitDays >= 7,        progress: Math.min(7, githubCommitDays),     target: 7 },
    { id: "github_30",      emoji: "🤖", title: "Code Machine",     desc: "Code for 30 days",                     unlocked: githubCommitDays >= 30,       progress: Math.min(30, githubCommitDays),    target: 30 },
    { id: "level_5",        emoji: "🚀", title: "Level 5",          desc: "Reach level 5",                        unlocked: levelInfo.level >= 5,         progress: Math.min(5, levelInfo.level),      target: 5 },
    { id: "level_10",       emoji: "👑", title: "Level 10",         desc: "Reach level 10",                       unlocked: levelInfo.level >= 10,        progress: Math.min(10, levelInfo.level),     target: 10 },
  ]

  return NextResponse.json({
    xp: {
      total: totalXp,
      byCategory: { habits: habitXp, sleep: sleepXp, weight: weightXp, mood: moodXp, journal: journalXp, intake: intakeXp, focus: focusXp, reading: readingXp, supplements: supplementXp, github: githubXp },
    },
    ...levelInfo,
    habitStreaks,
    achievements,
    githubStreak,
  })
}
