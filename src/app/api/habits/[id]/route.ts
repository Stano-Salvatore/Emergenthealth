import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { name, description, color, icon, isArchived, reminderTime } = await req.json()

  const habit = await prisma.habit.updateMany({
    where: { id, userId: session.user.id },
    data: { name, description, color, icon, isArchived },
  })

  if (reminderTime !== undefined) {
    await prisma.$executeRaw`UPDATE "Habit" SET "reminderTime" = ${reminderTime || null} WHERE id = ${id} AND "userId" = ${session.user.id}`.catch(() => {})
  }

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
