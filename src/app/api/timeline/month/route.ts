// One month of days, each reduced to what a single mark can carry.
//
// Everything read here is keyed by a DATE, not an instant: HealthLog.date,
// MoodLog.date and HabitCompletion.date are `@db.Date` columns, which Prisma
// hands back at UTC midnight, and SymptomLog.day is already a YYYY-MM-DD in
// the user's own timezone. So there is no bucketing to get wrong — the one
// place this route could have drifted has no drift in it.

import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { userToday } from "@/lib/user-timezone"
import { dayGlyph, monthGrid, type DayGlyph } from "@/lib/day-glyphs"

const dayOf = (d: Date) => d.toISOString().slice(0, 10)

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const asked = new URL(req.url).searchParams.get("month")
  const today = await userToday(userId)
  const month = /^\d{4}-\d{2}$/.test(asked ?? "") ? asked! : today.slice(0, 7)

  const cells = monthGrid(month)
  if (cells.length === 0) return NextResponse.json({ error: "bad month" }, { status: 400 })
  const inMonth = cells.filter(c => c.inMonth).map(c => c.date)
  const first = inMonth[0]
  const last = inMonth[inMonth.length - 1]
  const start = new Date(`${first}T00:00:00.000Z`)
  const end = new Date(`${last}T00:00:00.000Z`)

  const [health, moods, completions, habits, symptoms] = await Promise.all([
    prisma.healthLog.findMany({
      where: { userId, date: { gte: start, lte: end } },
      select: { date: true, sleepScore: true },
    }).catch(() => []),
    prisma.moodLog.findMany({
      where: { userId, date: { gte: start, lte: end } },
      select: { date: true, mood: true },
    }).catch(() => []),
    prisma.habitCompletion.findMany({
      where: { userId, date: { gte: start, lte: end } },
      select: { date: true, habitId: true },
    }).catch(() => []),
    prisma.habit.findMany({
      where: { userId, isArchived: false },
      select: { id: true, createdAt: true },
    }).catch(() => []),
    prisma.symptomLog.findMany({
      where: { userId, day: { gte: first, lte: last } },
      select: { day: true },
    }).catch(() => []),
  ])

  const sleepByDay = new Map<string, number>()
  for (const h of health) if (h.sleepScore != null) sleepByDay.set(dayOf(h.date), h.sleepScore)

  const moodByDay = new Map<string, number>()
  for (const m of moods) moodByDay.set(dayOf(m.date), m.mood)

  const doneByDay = new Map<string, number>()
  const firstTickByHabit = new Map<string, string>()
  for (const c of completions) {
    const k = dayOf(c.date)
    doneByDay.set(k, (doneByDay.get(k) ?? 0) + 1)
    const seen = firstTickByHabit.get(c.habitId)
    if (seen === undefined || k < seen) firstTickByHabit.set(c.habitId, k)
  }

  const symptomsByDay = new Map<string, number>()
  for (const s of symptoms) symptomsByDay.set(s.day, (symptomsByDay.get(s.day) ?? 0) + 1)

  // How many habits existed ON each day, not how many exist now. A habit
  // started on the 20th did not go undone for the first nineteen. Archived
  // ones are left out of every day: their history is gone, and counting them
  // would mark whole weeks incomplete against habits the user has deleted.
  //
  // `createdAt` alone is not the start: a habit can be ticked for days before
  // the row was written — by backfilling, or by an import — and counting from
  // createdAt then produced "3 done out of 0", which is not a thing. The
  // earlier of the two wins. Completions are only known for this month, so
  // the correction reaches exactly as far as the grid it is drawing.
  const habitBirthdays = habits.map(h => {
    const created = dayOf(h.createdAt)
    const ticked = firstTickByHabit.get(h.id)
    return ticked !== undefined && ticked < created ? ticked : created
  }).sort()

  const days: DayGlyph[] = inMonth.map(date => dayGlyph({
    date,
    mood: moodByDay.get(date) ?? null,
    sleepScore: sleepByDay.get(date) ?? null,
    habitsDone: doneByDay.get(date) ?? 0,
    habitsTotal: habitBirthdays.filter(b => b <= date).length,
    symptoms: symptomsByDay.get(date) ?? 0,
    future: date > today,
  }))

  return NextResponse.json({ month, days })
}
