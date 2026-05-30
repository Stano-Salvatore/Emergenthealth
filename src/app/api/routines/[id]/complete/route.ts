import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const routine = await prisma.habitRoutine.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!routine) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const existing = await prisma.habitCompletion.findMany({
    where: {
      habitId: { in: routine.habitIds },
      userId: session.user.id,
      date: today,
    },
    select: { habitId: true },
  })

  const alreadyDone = new Set(existing.map(c => c.habitId))
  const toComplete = routine.habitIds.filter(hid => !alreadyDone.has(hid))

  if (toComplete.length > 0) {
    await prisma.habitCompletion.createMany({
      data: toComplete.map(habitId => ({
        habitId,
        userId: session.user.id,
        date: today,
      })),
      skipDuplicates: true,
    })
  }

  return NextResponse.json({ completed: toComplete.length })
}
