import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const url = new URL(req.url)
  const date = url.searchParams.get("date") ?? new Date().toISOString().split("T")[0]

  // ?days=7 returns daily water totals for the last N days (for trend charts)
  const days = parseInt(url.searchParams.get("days") ?? "0")
  if (days > 0 && days <= 30) {
    const end = new Date(date + "T23:59:59.999Z")
    const start = new Date(end.getTime() - (days - 1) * 86400000)
    start.setUTCHours(0, 0, 0, 0)
    const logs = await prisma.intakeLog.findMany({
      where: { userId, type: "water", loggedAt: { gte: start, lte: end } },
      select: { amountMl: true, loggedAt: true },
    })
    // Group by day
    const byDay: Record<string, number> = {}
    for (const l of logs) {
      const day = l.loggedAt.toISOString().split("T")[0]
      byDay[day] = (byDay[day] ?? 0) + l.amountMl
    }
    return NextResponse.json(byDay)
  }

  const start = new Date(date + "T00:00:00.000Z")
  const end = new Date(date + "T23:59:59.999Z")

  const logs = await prisma.intakeLog.findMany({
    where: { userId, loggedAt: { gte: start, lte: end } },
    orderBy: { loggedAt: "asc" },
  })

  return NextResponse.json(logs)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { type, amountMl, note } = await req.json()
  if (!type || !amountMl || typeof amountMl !== "number") {
    return NextResponse.json({ error: "type and amountMl required" }, { status: 400 })
  }

  const log = await prisma.intakeLog.create({
    data: { userId, type, amountMl, note: note ?? null },
  })

  return NextResponse.json(log, { status: 201 })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id } = await req.json()
  const log = await prisma.intakeLog.findUnique({ where: { id } })
  if (!log || log.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await prisma.intakeLog.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
