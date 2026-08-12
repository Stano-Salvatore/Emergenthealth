import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"

export async function GET(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const url = new URL(req.url)
  const date = url.searchParams.get("date") ?? new Date().toISOString().split("T")[0]

  // ?days=7 returns daily calorie totals for the last N days (for trend charts)
  const days = parseInt(url.searchParams.get("days") ?? "0")
  if (days > 0 && days <= 30) {
    const end = new Date(date + "T23:59:59.999Z")
    const start = new Date(end.getTime() - (days - 1) * 86400000)
    start.setUTCHours(0, 0, 0, 0)
    const logs = await prisma.foodLog.findMany({
      where: { userId, loggedAt: { gte: start, lte: end } },
      select: { calories: true, loggedAt: true },
    })
    const byDay: Record<string, number> = {}
    for (const l of logs) {
      const day = l.loggedAt.toISOString().split("T")[0]
      byDay[day] = (byDay[day] ?? 0) + l.calories
    }
    return NextResponse.json(byDay)
  }

  const start = new Date(date + "T00:00:00.000Z")
  const end = new Date(date + "T23:59:59.999Z")
  const logs = await prisma.foodLog.findMany({
    where: { userId, loggedAt: { gte: start, lte: end } },
    orderBy: { loggedAt: "asc" },
  })
  return NextResponse.json(logs)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const body = await req.json().catch(() => null)
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : ""
  const calories = Number(body?.calories)
  if (!name || !Number.isFinite(calories) || calories < 0 || calories > 10000) {
    return NextResponse.json({ error: "name and calories required" }, { status: 400 })
  }

  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 && n <= 2000 ? Math.round(n * 10) / 10 : null
  }
  const MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack", "other"])

  const log = await prisma.foodLog.create({
    data: {
      userId,
      name,
      mealType: MEAL_TYPES.has(body?.mealType) ? body.mealType : "other",
      calories: Math.round(calories),
      proteinG: num(body?.proteinG),
      carbsG: num(body?.carbsG),
      fatG: num(body?.fatG),
      items: Array.isArray(body?.items) ? (body.items.slice(0, 20) as Prisma.InputJsonValue) : undefined,
      note: typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null,
      photo: typeof body?.photo === "string" && body.photo.startsWith("data:image/") && body.photo.length < 100_000
        ? body.photo
        : null,
    },
  })
  return NextResponse.json(log, { status: 201 })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const { id } = await req.json()
  const log = await prisma.foodLog.findUnique({ where: { id } })
  if (!log || log.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  await prisma.foodLog.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
