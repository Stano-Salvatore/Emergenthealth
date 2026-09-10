import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserTimezone } from "@/lib/user-timezone"
import { snoozeReminder } from "@/lib/reminders"

// POST { minutes } or { date, time? } — push a reminder to later.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { minutes?: unknown; date?: unknown; time?: unknown }

  const tz = await getUserTimezone(session.user.id)
  const input = typeof body.minutes === "number" && body.minutes > 0
    ? { minutes: Math.min(body.minutes, 60 * 24 * 30) }
    : typeof body.date === "string"
      ? { date: body.date, time: typeof body.time === "string" ? body.time : null }
      : null
  if (!input) return NextResponse.json({ error: "minutes or date required" }, { status: 400 })

  const r = await snoozeReminder(session.user.id, id, input, tz)
  if (!r.ok) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(r)
}
