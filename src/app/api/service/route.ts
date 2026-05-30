import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Service API — accepts Bearer CRON_SECRET for server-to-server operations.
// Allows Claude Code (and other trusted callers) to act on behalf of a user
// identified by email without a browser session.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get("authorization") === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { action, email } = body

  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 })

  const user = await prisma.user.findFirst({ where: { email }, select: { id: true } })
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

  // ── create_reminder ────────────────────────────────────────────────────────
  if (action === "create_reminder") {
    const { title, dueDate, description, priority, reminderTime } = body
    if (!title) return NextResponse.json({ error: "title required" }, { status: 400 })

    const reminder = await prisma.reminder.create({
      data: {
        userId: user.id,
        title,
        description: description ?? null,
        dueDate: dueDate ? new Date(dueDate) : null,
        reminderTime: reminderTime ?? null,
        priority: priority ?? "normal",
      },
    })
    return NextResponse.json({ ok: true, reminder })
  }

  // ── list_reminders ─────────────────────────────────────────────────────────
  if (action === "list_reminders") {
    const reminders = await prisma.reminder.findMany({
      where: { userId: user.id, isCompleted: false },
      orderBy: { dueDate: "asc" },
      take: 20,
    })
    return NextResponse.json({ ok: true, reminders })
  }

  // ── complete_reminder ──────────────────────────────────────────────────────
  if (action === "complete_reminder") {
    const { id } = body
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 })
    await prisma.reminder.updateMany({
      where: { id, userId: user.id },
      data: { isCompleted: true, completedAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  }

  // ── create_habit_completion ────────────────────────────────────────────────
  if (action === "complete_habit") {
    const { habitId } = body
    if (!habitId) return NextResponse.json({ error: "habitId required" }, { status: 400 })
    const today = new Date(); today.setHours(0, 0, 0, 0)
    await prisma.habitCompletion.upsert({
      where: { habitId_date: { habitId, date: today } },
      create: { habitId, userId: user.id, date: today },
      update: {},
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
