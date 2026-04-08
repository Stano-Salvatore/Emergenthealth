import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(today.getDate() - 30)

  const habits = await prisma.habit.findMany({
    where: { userId: session.user.id, isArchived: false },
    include: {
      completions: {
        where: { date: { gte: thirtyDaysAgo } },
        orderBy: { date: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  const todayStr = today.toISOString().split("T")[0]

  const result = habits.map((h) => {
    const completionDates = new Set(h.completions.map((c) => c.date.toISOString().split("T")[0]))
    let streak = 0
    const cursor = new Date(today)
    while (completionDates.has(cursor.toISOString().split("T")[0])) {
      streak++
      cursor.setDate(cursor.getDate() - 1)
    }
    return {
      ...h,
      streak,
      completedToday: completionDates.has(todayStr),
    }
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { name, description, color, icon } = await req.json()
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const habit = await prisma.habit.create({
    data: {
      userId: session.user.id,
      name,
      description,
      color: color ?? "#6366f1",
      icon,
    },
  })

  return NextResponse.json(habit, { status: 201 })
}
