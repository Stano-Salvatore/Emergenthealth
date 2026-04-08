import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const reminders = await prisma.reminder.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isCompleted: "asc" }, { dueDate: "asc" }],
  })

  return NextResponse.json(reminders)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { title, description, dueDate, priority } = await req.json()
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 })

  const reminder = await prisma.reminder.create({
    data: {
      userId: session.user.id,
      title,
      description,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      priority: priority ?? "normal",
    },
  })

  return NextResponse.json(reminder, { status: 201 })
}
