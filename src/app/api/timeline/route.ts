import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { searchParams } = new URL(req.url)
  const dateStr = searchParams.get("date") ?? new Date().toISOString().slice(0, 10)
  const dateObj = new Date(dateStr + "T00:00:00.000Z")
  const nextDay = new Date(dateStr + "T00:00:00.000Z")
  nextDay.setDate(nextDay.getDate() + 1)

  const [healthLog, mood, habits, habitCompletions, intake, focusSessions, dailyNote, tags, checkinRows, customEvents] = await Promise.all([
    prisma.healthLog.findFirst({
      where: { userId, date: dateObj },
      select: {
        sleepDuration: true, deepSleep: true, remSleep: true, lightSleep: true,
        awakeTime: true, timeInBed: true, sleepEfficiency: true, sleepLatency: true,
        steps: true, activeMinutes: true, activityScore: true, caloriesBurned: true,
        distanceKm: true, readinessScore: true, hrv: true, restingHR: true,
        spo2: true, skinTemp: true, breathingRate: true, sleepScore: true,
        weight: true, sleepStart: true, sleepEnd: true, sedentaryTime: true,
        stressHigh: true, recoveryHigh: true,
      },
    }),
    prisma.moodLog.findFirst({ where: { userId, date: dateObj }, select: { mood: true, note: true } }),
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      select: { id: true, name: true, color: true, icon: true },
    }).catch(() => []),
    prisma.habitCompletion.findMany({
      where: { userId, date: dateObj },
      select: { habitId: true },
    }),
    prisma.intakeLog.findMany({
      where: { userId, loggedAt: { gte: dateObj, lt: nextDay } },
      select: { type: true, amountMl: true, loggedAt: true, note: true },
      orderBy: { loggedAt: "asc" },
    }).catch(() => []),
    prisma.focusSession.findMany({
      where: { userId, startedAt: { gte: dateObj, lt: nextDay } },
      select: { label: true, durationMin: true, startedAt: true, endedAt: true, type: true },
      orderBy: { startedAt: "asc" },
    }).catch(() => []),
    prisma.dailyNote.findFirst({ where: { userId, date: dateObj }, select: { content: true } }).catch(() => null),
    prisma.$queryRaw<{ id: string; tagName: string | null; text: string | null; timestamp: Date }[]>`
      SELECT "id","tagName","text","timestamp"
      FROM "OuraTag"
      WHERE "userId" = ${userId} AND "day" = ${dateStr}
      ORDER BY "timestamp" ASC
    `.catch(() => []),
    prisma.$queryRaw<{ energy: number; mood: number; intention: string | null; waterGoalMl: number }[]>`
      SELECT "energy", "mood", "intention", "waterGoalMl"
      FROM "MorningCheckIn"
      WHERE "userId" = ${userId} AND "date" = ${dateStr}
      LIMIT 1
    `.catch(() => []),
    prisma.timelineEvent.findMany({
      where: { userId, occurredAt: { gte: dateObj, lt: nextDay } },
      select: { id: true, emoji: true, label: true, note: true, imageData: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
    }).catch(() => []),
  ])

  const checkin = (checkinRows as { energy: number; mood: number; intention: string | null; waterGoalMl: number }[])[0] ?? null
  const completedIds = new Set(habitCompletions.map((c: { habitId: string }) => c.habitId))

  return NextResponse.json({
    date: dateStr,
    healthLog,
    mood,
    habits: (habits as { id: string; name: string; color: string; icon?: string | null }[]).map(h => ({
      name: h.name,
      color: h.color,
      emoji: h.icon ?? null,
      completed: completedIds.has(h.id),
    })),
    intake: (intake as { type: string; amountMl: number; loggedAt: Date; note: string | null }[]).map(l => ({
      type: l.type,
      amountMl: l.amountMl,
      loggedAt: l.loggedAt.toISOString(),
      note: l.note,
    })),
    focusSessions: (focusSessions as { label: string | null; durationMin: number; startedAt: Date; endedAt: Date; type: string }[]).map(s => ({
      label: s.label,
      durationMin: s.durationMin,
      startedAt: s.startedAt.toISOString(),
      endedAt: s.endedAt.toISOString(),
      type: s.type,
    })),
    dailyNote: dailyNote ?? null,
    checkin,
    tags: (tags as { id: string; tagName: string | null; text: string | null; timestamp: Date }[]).map(t => ({
      tagName: t.tagName,
      text: t.text,
      timestamp: t.timestamp.toISOString(),
    })),
    customEvents: (customEvents as { id: string; emoji: string; label: string; note: string | null; imageData: string | null; occurredAt: Date }[]).map(e => ({
      id: e.id,
      emoji: e.emoji,
      label: e.label,
      note: e.note,
      imageData: e.imageData,
      occurredAt: e.occurredAt.toISOString(),
    })),
  })
}
