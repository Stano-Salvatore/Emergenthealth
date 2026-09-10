import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { normalizeSchedule } from "@/lib/habit-schedule"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { name, description, color, icon, isArchived, reminderTime } = body
  // Schedule fields travel together: sending either rewrites both, so a
  // habit can't end up with weekday picks and a weekly target at once.
  const scheduleTouched = body.scheduleDays !== undefined || body.timesPerWeek !== undefined
  const schedule = scheduleTouched ? normalizeSchedule(body) : null

  const habit = await prisma.habit.updateMany({
    where: { id, userId: session.user.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(color !== undefined && { color }),
      ...(icon !== undefined && { icon }),
      ...(isArchived !== undefined && { isArchived }),
      ...(reminderTime !== undefined && { reminderTime: reminderTime || null }),
      ...(schedule && { scheduleDays: schedule.scheduleDays, timesPerWeek: schedule.timesPerWeek }),
    },
  })

  if (habit.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  await prisma.habit.deleteMany({ where: { id, userId: session.user.id } })
  return NextResponse.json({ success: true })
}
