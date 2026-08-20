import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { readSchedule, writeSchedule } from "@/lib/weekly-review-schedule"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// When Emergy's weekly review lands, in the user's own timezone. This used to
// live at /api/digest/schedule and wrote User.digestDay / digestHour, which
// only an endpoint outside the cron loop ever read — so the schedule was
// decorative. Same picker, pointed at the email that actually sends.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return NextResponse.json(await readSchedule(session.user.id))
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { day, hour } = await req.json().catch(() => ({}))
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    return NextResponse.json({ error: "day must be 0-6" }, { status: 400 })
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return NextResponse.json({ error: "hour must be 0-23" }, { status: 400 })
  }

  await writeSchedule(session.user.id, { day, hour })
  return NextResponse.json({ ok: true, day, hour })
}
