import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const routines = await prisma.habitRoutine.findMany({
    where: { userId: session.user.id },
    orderBy: { sortOrder: "asc" },
  })

  const habitIds = [...new Set(routines.flatMap(r => r.habitIds))]

  const habits = habitIds.length > 0
    ? await prisma.habit.findMany({
        where: { id: { in: habitIds }, userId: session.user.id, isArchived: false },
        select: { id: true, name: true, color: true },
      })
    : []

  const completions = habitIds.length > 0
    ? await prisma.habitCompletion.findMany({
        where: {
          habitId: { in: habitIds },
          userId: session.user.id,
          date: today,
        },
        select: { habitId: true },
      })
    : []

  const completedSet = new Set(completions.map(c => c.habitId))
  const habitMap = new Map(habits.map(h => [h.id, h]))

  const result = routines.map(r => {
    const routineHabits = r.habitIds
      .map(id => habitMap.get(id))
      .filter((h): h is { id: string; name: string; color: string } => Boolean(h))
    const completedCount = routineHabits.filter(h => completedSet.has(h.id)).length
    return {
      id: r.id,
      name: r.name,
      emoji: r.emoji,
      sortOrder: r.sortOrder,
      habits: routineHabits,
      completedCount,
      totalCount: routineHabits.length,
      allDone: routineHabits.length > 0 && completedCount === routineHabits.length,
    }
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { name, emoji, habitIds } = await req.json()
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const routine = await prisma.habitRoutine.create({
    data: {
      userId: session.user.id,
      name,
      emoji: emoji ?? "⭐",
      habitIds: habitIds ?? [],
    },
  })

  return NextResponse.json(routine, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  await prisma.habitRoutine.deleteMany({
    where: { id, userId: session.user.id },
  })

  return NextResponse.json({ success: true })
}
