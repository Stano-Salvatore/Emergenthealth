import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const habit = await prisma.habit.findFirst({
    where: { id, userId: session.user.id },
  })
  if (!habit) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const dateStr = body.date ?? new Date().toISOString().split("T")[0]
  const dateObj = new Date(dateStr)
  dateObj.setUTCHours(0, 0, 0, 0)

  const completion = await prisma.habitCompletion.upsert({
    where: { habitId_date: { habitId: id, date: dateObj } },
    create: { habitId: id, userId: session.user.id, date: dateObj },
    update: {},
  })

  return NextResponse.json(completion)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const dateStr = body.date ?? new Date().toISOString().split("T")[0]
  const dateObj = new Date(dateStr)
  dateObj.setUTCHours(0, 0, 0, 0)

  await prisma.habitCompletion.deleteMany({
    where: { habitId: id, userId: session.user.id, date: dateObj },
  })

  return NextResponse.json({ success: true })
}
