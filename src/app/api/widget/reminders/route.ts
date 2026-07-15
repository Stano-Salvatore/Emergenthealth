import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Home-screen Reminders widget API. Same x-widget-key auth as the other widget routes.

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

function startOfTodayUtc(): Date {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, 0, 0, 0))
}

// GET — active reminders, each tagged overdue / today / upcoming.
export async function GET(req: NextRequest) {
  const apiKey = keyFrom(req)
  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 401 })
  const userId = await resolveUserByApiKey(apiKey)
  if (!userId) return NextResponse.json({ error: "Invalid API key" }, { status: 401 })

  const reminders = await prisma.reminder.findMany({
    where: { userId, isCompleted: false },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: 20,
  })

  const todayStart = startOfTodayUtc()
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

  const items = reminders.map(r => {
    let state: "overdue" | "today" | "upcoming" = "upcoming"
    if (r.dueDate) {
      if (r.dueDate < todayStart) state = "overdue"
      else if (r.dueDate < todayEnd) state = "today"
    }
    return {
      id: r.id,
      title: r.title,
      state,
      priority: r.priority,
      due: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
    }
  })

  return NextResponse.json({
    reminders: items,
    counts: {
      overdue: items.filter(i => i.state === "overdue").length,
      today: items.filter(i => i.state === "today").length,
      upcoming: items.filter(i => i.state === "upcoming").length,
    },
  })
}

// POST { reminderId } — mark a reminder done.
export async function POST(req: NextRequest) {
  const apiKey = keyFrom(req)
  if (!apiKey) return NextResponse.json({ error: "Missing API key" }, { status: 401 })
  const userId = await resolveUserByApiKey(apiKey)
  if (!userId) return NextResponse.json({ error: "Invalid API key" }, { status: 401 })

  let body: { reminderId?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  const reminderId = typeof body.reminderId === "string" ? body.reminderId : ""
  if (!reminderId) return NextResponse.json({ error: "reminderId required" }, { status: 400 })

  // Scoped update — only completes a reminder that belongs to this user.
  const res = await prisma.reminder.updateMany({
    where: { id: reminderId, userId },
    data: { isCompleted: true, completedAt: new Date() },
  })
  if (res.count === 0) return NextResponse.json({ error: "Reminder not found" }, { status: 404 })

  return NextResponse.json({ ok: true, reminderId })
}
