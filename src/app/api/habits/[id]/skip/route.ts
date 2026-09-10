import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { userToday } from "@/lib/user-timezone"

// "Not today, because…" — a skip holds the streak the way a vacation day does
// and never counts as done. It lives in its own table (see HabitSkip) and a
// day can't be both done and skipped: skipping removes that day's tick.

const REASON_MAX = 120

function dayFrom(body: { date?: unknown }, fallback: string): string | null {
  const raw = typeof body.date === "string" ? body.date : fallback
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { id } = await params

  const habit = await prisma.habit.findFirst({ where: { id, userId }, select: { id: true } })
  if (!habit) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { date?: unknown; reason?: unknown }
  const day = dayFrom(body, await userToday(userId))
  if (!day) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, REASON_MAX) : null
  const date = new Date(day + "T00:00:00Z")

  await prisma.$transaction([
    prisma.habitCompletion.deleteMany({ where: { habitId: id, userId, date } }),
    prisma.habitSkip.upsert({
      where: { habitId_date: { habitId: id, date } },
      create: { habitId: id, userId, date, reason },
      update: { reason },
    }),
  ])
  return NextResponse.json({ ok: true, date: day, reason })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { date?: unknown }
  const day = dayFrom(body, await userToday(userId))
  if (!day) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 })
  await prisma.habitSkip.deleteMany({ where: { habitId: id, userId, date: new Date(day + "T00:00:00Z") } })
  return NextResponse.json({ ok: true })
}
