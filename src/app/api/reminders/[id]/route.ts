import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { normalizeRepeat } from "@/lib/recurrence"
import { completeReminder, uncompleteReminder } from "@/lib/reminders"

function dayOrNull(raw: unknown): Date | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null || raw === "") return null
  const s = String(raw).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  return new Date(s + "T00:00:00Z")
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const { title, description, dueDate, reminderTime, priority, isCompleted, tags } = body

  // Completing goes through lib/reminders so a repeating reminder rolls
  // forward instead of dying — the same path the widget and Emergy use.
  if (isCompleted === true) {
    const r = await completeReminder(session.user.id, id)
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 })
    return NextResponse.json({ success: true, rolledTo: r.rolledTo })
  }
  if (isCompleted === false) {
    const r = await uncompleteReminder(session.user.id, id)
    if (!r.ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const repeatTouched = body.repeat !== undefined
  const repeat = repeatTouched ? normalizeRepeat(body.repeat) : undefined
  const due = dayOrNull(dueDate)

  const result = await prisma.reminder.updateMany({
    where: { id, userId: session.user.id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(due !== undefined && { dueDate: due }),
      ...(reminderTime !== undefined && { reminderTime: reminderTime || null }),
      ...(priority !== undefined && { priority }),
      ...(tags !== undefined && { tags: Array.isArray(tags) ? tags : [] }),
      ...(repeat !== undefined && { repeat }),
      ...(body.repeatUntil !== undefined && { repeatUntil: dayOrNull(body.repeatUntil) ?? null }),
      ...(repeat === null && { repeatUntil: null }),
    },
  })

  if (result.count === 0 && isCompleted === undefined) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ success: true })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  // ?history=1 also removes the done copies a repeating reminder left behind.
  const withHistory = new URL(req.url).searchParams.get("history") === "1"
  await prisma.reminder.deleteMany({ where: { id, userId: session.user.id } })
  if (withHistory) await prisma.reminder.deleteMany({ where: { seriesId: id, userId: session.user.id } })
  return NextResponse.json({ success: true })
}
