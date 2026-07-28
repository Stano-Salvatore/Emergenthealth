import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUpcomingEvents, getEventsInRange } from "@/lib/google-calendar"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get("from")
  const to = searchParams.get("to")

  // Explicit window (used by the calendar page to page across the whole year).
  if (from && to && !Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to))) {
    const events = await getEventsInRange(session.user.id, from, to)
    return NextResponse.json(events)
  }

  const days = Number(searchParams.get("days") ?? 14)
  const events = await getUpcomingEvents(session.user.id, days)
  return NextResponse.json(events)
}
