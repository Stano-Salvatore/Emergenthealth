import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Upsert today's native screen-time reading (sent from the Android app).
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => ({}))
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null
  const totalMin = Number.isFinite(body.totalMin) ? Math.max(0, Math.round(body.totalMin)) : null
  if (!date || totalMin == null) return NextResponse.json({ error: "date and totalMin required" }, { status: 400 })

  const firstUnlockMin =
    Number.isFinite(body.firstUnlockMin) && body.firstUnlockMin >= 0 ? Math.round(body.firstUnlockMin) : null

  await prisma.screenTimeLog.upsert({
    where: { userId_date: { userId, date } },
    create: { userId, date, totalMin, firstUnlockMin },
    update: { totalMin, firstUnlockMin },
  })

  return NextResponse.json({ ok: true })
}

// Today's stored reading (used by the settings card).
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const date = new Date()
  const dateStr = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")

  const row = await prisma.screenTimeLog.findUnique({
    where: { userId_date: { userId, date: dateStr } },
    select: { totalMin: true, firstUnlockMin: true, date: true },
  })

  return NextResponse.json(row ?? null)
}
