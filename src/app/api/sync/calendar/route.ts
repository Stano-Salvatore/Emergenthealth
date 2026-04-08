import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUpcomingEvents } from "@/lib/google-calendar"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const days = Number(searchParams.get("days") ?? 14)

  const events = await getUpcomingEvents(session.user.id, days)
  return NextResponse.json(events)
}
