import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { normalizeRepeat } from "@/lib/recurrence"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const reminders = await prisma.reminder.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isCompleted: "asc" }, { dueDate: "asc" }, { reminderTime: "asc" }],
  })

  return NextResponse.json(reminders)
}

/** YYYY-MM-DD or null; anything else is refused rather than stored as 1970. */
function dayOrNull(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === "") return null
  const s = String(raw).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  return new Date(s + "T00:00:00Z")
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { title, description, dueDate, priority, tags, reminderTime } = body
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 })

  const repeat = normalizeRepeat(body.repeat)
  const due = dayOrNull(dueDate)
  // A rule needs a date to count from; without one it is silently a one-off.
  const reminder = await prisma.reminder.create({
    data: {
      userId: session.user.id,
      title,
      description,
      dueDate: due ?? undefined,
      reminderTime: reminderTime || null,
      priority: priority ?? "normal",
      tags: Array.isArray(tags) ? tags : [],
      repeat: due ? repeat : null,
      repeatUntil: due && repeat ? dayOrNull(body.repeatUntil) ?? null : null,
    },
  })

  return NextResponse.json(reminder, { status: 201 })
}
