import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserPlan } from "@/lib/plan"
import { getUserTimezone, localDateStr, addDaysISO } from "@/lib/local-date"

const FREE_HABIT_LIMIT = 10

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // The user's day, not the server's — completions are filed under the date
  // shown on the user's phone, so "today" has to mean the same thing here.
  const timezone = await getUserTimezone(session.user.id)
  const todayStr = localDateStr(timezone)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const plan = await getUserPlan(session.user.id)
  const historyDays = plan === "pro" ? 730 : 30
  const historyFrom = new Date(today)
  historyFrom.setDate(today.getDate() - historyDays - 1)

  const habits = await prisma.habit.findMany({
    where: { userId: session.user.id, isArchived: false },
    include: {
      completions: {
        where: { date: { gte: historyFrom } },
        orderBy: { date: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  // Load vacation mode — frozen days don't break streaks
  let vacationFrom: string | null = null
  let vacationUntil: string | null = null
  try {
    const vRows = await prisma.$queryRaw<{ value: string }[]>`
      SELECT "value" FROM "UserPreference" WHERE "userId" = ${session.user.id} AND "key" = 'vacation_mode' LIMIT 1
    `
    if (vRows.length) {
      const v = JSON.parse(vRows[0].value)
      if (v.active && v.from && v.until) {
        vacationFrom  = String(v.from).slice(0, 10)
        vacationUntil = String(v.until).slice(0, 10)
      }
    }
  } catch {}

  function isFrozen(day: string): boolean {
    if (!vacationFrom || !vacationUntil) return false
    return day >= vacationFrom && day <= vacationUntil
  }

  const result = habits.map((h) => {
    const completionDates = new Set(h.completions.map((c) => c.date.toISOString().split("T")[0]))
    const completedToday = completionDates.has(todayStr)

    // The streak used to start counting at today, so an unbroken run showed as
    // "0 day streak" every morning until the box was ticked — and because the
    // client compares the before/after streak to decide whether to celebrate, a
    // reset-to-zero made it fire the 7-day milestone banner every single day.
    // Today is still in progress, so it only extends the streak; it never ends
    // one. Count back from yesterday when today isn't done yet.
    let cursor = completedToday || isFrozen(todayStr) ? todayStr : addDaysISO(todayStr, -1)
    let streak = 0
    while (completionDates.has(cursor) || isFrozen(cursor)) {
      if (!isFrozen(cursor)) streak++ // frozen days hold the streak without extending it
      cursor = addDaysISO(cursor, -1)
      if (streak > 365) break // safety
    }

    return {
      ...h,
      streak,
      completedToday,
      frozen: isFrozen(todayStr),
    }
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { name, description, color, icon, reminderTime } = await req.json()
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  // Enforce free-tier habit limit
  const plan = await getUserPlan(session.user.id)
  if (plan === "free") {
    const count = await prisma.habit.count({ where: { userId: session.user.id, isArchived: false } })
    if (count >= FREE_HABIT_LIMIT) {
      return NextResponse.json({ error: "Free plan is limited to 10 habits. Upgrade to Pro for unlimited habits.", upgrade: true }, { status: 403 })
    }
  }

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
