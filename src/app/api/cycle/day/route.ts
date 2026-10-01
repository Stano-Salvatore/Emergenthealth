import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { localDateStr } from "@/lib/local-date"
import { getUserTimezone } from "@/lib/user-timezone"
import { parseDayInput } from "@/lib/cycle-input"
import { saveCycleDay } from "@/lib/cycle-load"

export const dynamic = "force-dynamic"

/** Log or change one day. Only the fields sent change; a null clears one. */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  const today = localDateStr(await getUserTimezone(userId))
  const parsed = parseDayInput(await req.json().catch(() => null), today)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  try {
    const saved = await saveCycleDay(userId, parsed.day, parsed.data)
    return NextResponse.json({ ok: true, day: parsed.day, log: saved })
  } catch (e) {
    console.error("[cycle] save failed:", e)
    return NextResponse.json({ error: "That day wasn't saved — try again." }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const day = new URL(req.url).searchParams.get("day") ?? ""
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: "day required" }, { status: 400 })
  const { prisma } = await import("@/lib/prisma")
  await prisma.cycleDay.deleteMany({ where: { userId: session.user.id, day } })
  return NextResponse.json({ ok: true })
}
