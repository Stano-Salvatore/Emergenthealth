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

  // Load vacation mode — frozen days don't break streaks
  let vacationFrom: Date | null = null
  let vacationUntil: Date | null = null
  try {
    const vRows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "UserPreference" WHERE "userId" = ${session.user.id} AND "key" = 'vacation_mode' LIMIT 1
    `
    if (vRows.length) {
      const v = JSON.parse(vRows[0].value)
      if (v.active && v.from && v.until) {
        vacationFrom  = new Date(v.from)
        vacationUntil = new Date(v.until)
      }
    }
  } catch {}

  function isFrozen(d: Date): boolean {
    if (!vacationFrom || !vacationUntil) return false
    return d >= vacationFrom && d <= vacationUntil
  }

  const result = habits.map((h) => {
    const completionDates = new Set(h.completions.map((c) => c.date.toISOString().split("T")[0]))
    let streak = 0
    const cursor = new Date(today)
    while (completionDates.has(cursor.toISOString().split("T")[0]) || isFrozen(cursor)) {
      if (!isFrozen(cursor)) streak++ // frozen days don't count toward streak length but don't break it
      cursor.setDate(cursor.getDate() - 1)
      if (streak > 365) break // safety
    }
    return {
      ...h,
      streak,
      completedToday: completionDates.has(todayStr),
      frozen: isFrozen(today),
    }
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { name, description, color, icon, reminderTime } = await req.json()
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const habit = await prisma.habit.create({
    data: {
      userId: session.user.id,
      name,
      description,
      color: color ?? "#6366f1",
      icon,
      reminderTime: reminderTime || null,
    },
  })

  return NextResponse.json(habit, { status: 201 })
}
