import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Home-screen Habits widget API. Auth mirrors /api/widget/status: an x-widget-key
// header (or ?key=) resolved to a user via the widget_api_key UserPreference row.

async function resolveUserByApiKey(apiKey: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "UserPreference"
    WHERE "key" = 'widget_api_key' AND "value" = ${apiKey}
    LIMIT 1
  `.catch(() => [] as { userId: string }[])
  return rows[0]?.userId ?? null
}

function keyFrom(req: NextRequest): string {
  return req.headers.get("x-widget-key") ?? new URL(req.url).searchParams.get("key") ?? ""
}

// Date-only at UTC midnight — matches HabitCompletion's @db.Date column and the
// existing MCP complete_habit tool, so widget + app + MCP all agree on "today".
function utcMidnight(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// GET — today's habits with completion status and current streak.
export async function GET(req: NextRequest) {
  const apiKey = keyFrom(req)
  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 401 })
  const userId = await resolveUserByApiKey(apiKey)
  if (!userId) return NextResponse.json({ error: "Invalid API key" }, { status: 401 })

  const today = utcMidnight()
  const since = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000)
  const todayStr = isoDay(today)

  const habits = await prisma.habit.findMany({
    where: { userId, isArchived: false },
    orderBy: { createdAt: "asc" },
    include: {
      completions: { where: { date: { gte: since } }, orderBy: { date: "desc" } },
    },
  })

  const result = habits.map(h => {
    const days = new Set(h.completions.map(c => isoDay(c.date)))
    let streak = 0
    const cursor = new Date(today)
    while (days.has(isoDay(cursor))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1) }
    return { id: h.id, name: h.name, color: h.color, done: days.has(todayStr), streak }
  })

  return NextResponse.json({
    habits: result,
    done: result.filter(h => h.done).length,
    total: result.length,
    date: todayStr,
  })
}

// POST { habitId, done } — set today's completion state for a habit.
export async function POST(req: NextRequest) {
  const apiKey = keyFrom(req)
  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 401 })
  const userId = await resolveUserByApiKey(apiKey)
  if (!userId) return NextResponse.json({ error: "Invalid API key" }, { status: 401 })

  let body: { habitId?: unknown; done?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  const habitId = typeof body.habitId === "string" ? body.habitId : ""
  if (!habitId) return NextResponse.json({ error: "habitId required" }, { status: 400 })

  // Ownership check — never mutate another user's habit.
  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } })
  if (!habit) return NextResponse.json({ error: "Habit not found" }, { status: 404 })

  const date = utcMidnight()
  const done = body.done !== false // default to marking complete

  if (done) {
    await prisma.habitCompletion.upsert({
      where: { habitId_date: { habitId, date } },
      create: { habitId, userId, date },
      update: {},
    })
  } else {
    await prisma.habitCompletion.deleteMany({ where: { habitId, date } })
  }

  return NextResponse.json({ ok: true, habitId, done })
}
